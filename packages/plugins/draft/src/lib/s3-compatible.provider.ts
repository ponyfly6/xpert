import { FileStorageOption, UploadedFile } from '@metad/contracts'
import { IFileStorageProvider, IPluginConfigResolver, PLUGIN_CONFIG_RESOLVER_TOKEN } from '@xpert-ai/plugin-sdk'
import { Inject, Injectable, Optional } from '@nestjs/common'
import { ConfigType } from '@nestjs/config'
import { S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import multerS3 from 'multer-s3'
import { StorageEngine } from 'multer'
import { basename } from 'path'
import {
  DRAFT_FILE_STORAGE_PLUGIN_NAME,
  DraftFileStoragePluginConfig,
  S3CompatibleProviderConfig
} from './file-storage.types'
import { draftFileStoragePluginConfig } from './file-storage.config'
import { buildTenantScopedObjectKey, normalizeKey } from './storage-provider.utils'

type TS3CompatibleRuntimeConfig = Required<
  Pick<S3CompatibleProviderConfig, 'rootPath' | 'region' | 'forcePathStyle' | 'signedUrlExpires'>
> &
  Omit<S3CompatibleProviderConfig, 'rootPath' | 'region' | 'forcePathStyle' | 'signedUrlExpires'>

type TS3CompatibleSectionKey = 'minio' | 'rustfs' | 's3' | 'wasabi'

@Injectable()
export abstract class S3CompatibleProvider implements IFileStorageProvider {
  abstract readonly name: string
  protected abstract readonly configKey: TS3CompatibleSectionKey
  protected defaultForcePathStyle = false

  constructor(
    @Optional()
    @Inject(draftFileStoragePluginConfig.KEY)
    private readonly envConfig: ConfigType<typeof draftFileStoragePluginConfig> | undefined,
    @Optional()
    @Inject(PLUGIN_CONFIG_RESOLVER_TOKEN)
    private readonly pluginConfigResolver?: IPluginConfigResolver
  ) {}

  get config(): TS3CompatibleRuntimeConfig {
    return this.mergeConfig()
  }

  async url(filePath: string): Promise<string> {
    const config = this.getValidatedConfig()
    if (config.publicUrl) {
      return this.buildProviderPublicUrl(config, filePath)
    }

    const s3 = this.getS3Instance(config)
    const command = new GetObjectCommand({
      Bucket: config.bucket,
      Key: filePath
    })
    return getSignedUrl(s3, command, { expiresIn: config.signedUrlExpires })
  }

  path(filePath: string): string {
    const config = this.mergeConfig()
    return filePath ? normalizeKey(config.rootPath, filePath) : null
  }

  handler({ dest, filename, prefix }: FileStorageOption): StorageEngine {
    const config = this.getValidatedConfig()
    return multerS3({
      s3: this.getS3Instance(config),
      bucket: config.bucket,
      metadata: (_req, file, cb) => {
        cb(null, { fieldName: file.fieldname })
      },
      key: (_req, file, callback) => {
        const key = buildTenantScopedObjectKey(config.rootPath, file, dest, filename, prefix)
        callback(null, key)
      }
    })
  }

  async getFile(key: string): Promise<Buffer> {
    const config = this.getValidatedConfig()
    const s3 = this.getS3Instance(config)
    const command = new GetObjectCommand({
      Bucket: config.bucket,
      Key: key
    })

    const data = await s3.send(command)
    const body = await data.Body.transformToByteArray()
    return Buffer.from(body)
  }

  async putFile(fileContent: string | Buffer | URL, key = ''): Promise<UploadedFile> {
    const config = this.getValidatedConfig()
    const fileName = basename(key)
    const s3 = this.getS3Instance(config)

    const putCommand = new PutObjectCommand({
      Bucket: config.bucket,
      Body: fileContent as string | Buffer,
      Key: key,
      ContentDisposition: `inline; filename="${fileName}"`
    })
    await s3.send(putCommand)

    const headCommand = new HeadObjectCommand({
      Bucket: config.bucket,
      Key: key
    })
    const res = await s3.send(headCommand)
    const size = res.ContentLength || 0

    return this.mapUploadedFile({
      originalname: fileName,
      size,
      filename: fileName,
      path: key,
      key
    })
  }

  async deleteFile(key: string): Promise<void> {
    const config = this.getValidatedConfig()
    const s3 = this.getS3Instance(config)
    const command = new DeleteObjectCommand({
      Bucket: config.bucket,
      Key: key
    })
    await s3.send(command)
  }

  async mapUploadedFile(file: any): Promise<UploadedFile> {
    file.filename = file.originalname
    file.url = file.url || (await this.url(file.key))
    return file
  }

  protected mergeConfig(): TS3CompatibleRuntimeConfig {
    const pluginSection = this.resolvePluginSection()
    const envSection = (this.envConfig?.[this.configKey] ?? {}) as S3CompatibleProviderConfig

    return {
      rootPath: pluginSection.rootPath ?? envSection.rootPath ?? '',
      accessKeyId: pluginSection.accessKeyId ?? envSection.accessKeyId,
      secretAccessKey: pluginSection.secretAccessKey ?? envSection.secretAccessKey,
      region: pluginSection.region ?? envSection.region ?? 'us-east-1',
      bucket: pluginSection.bucket ?? envSection.bucket,
      endpoint: pluginSection.endpoint ?? envSection.endpoint,
      publicUrl: pluginSection.publicUrl ?? envSection.publicUrl,
      forcePathStyle: pluginSection.forcePathStyle ?? envSection.forcePathStyle ?? this.defaultForcePathStyle,
      signedUrlExpires: pluginSection.signedUrlExpires ?? envSection.signedUrlExpires ?? 3600
    }
  }

  protected getS3Instance(config: TS3CompatibleRuntimeConfig): S3Client {
    return new S3Client({
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey
      },
      region: config.region,
      endpoint: config.endpoint || undefined,
      forcePathStyle: config.forcePathStyle !== false
    })
  }

  private resolvePluginSection(): S3CompatibleProviderConfig {
    const pluginConfig =
      this.pluginConfigResolver?.resolve<DraftFileStoragePluginConfig & Record<string, any>>(
        DRAFT_FILE_STORAGE_PLUGIN_NAME,
        {
          defaults: {}
        }
      ) ?? {}

    if (this.configKey === 'minio' && this.looksLikeLegacyMinioConfig(pluginConfig)) {
      return pluginConfig as S3CompatibleProviderConfig
    }

    return (pluginConfig[this.configKey] ?? {}) as S3CompatibleProviderConfig
  }

  private looksLikeLegacyMinioConfig(config: Record<string, any>) {
    return !!config && !config['minio'] && ('bucket' in config || 'endpoint' in config || 'accessKeyId' in config)
  }

  private getValidatedConfig(): TS3CompatibleRuntimeConfig {
    const config = this.mergeConfig()
    if (!config.bucket) {
      throw new Error(`${this.name} bucket is not configured`)
    }

    return config
  }

  private buildProviderPublicUrl(config: TS3CompatibleRuntimeConfig, key: string) {
    const base = `${config.publicUrl || ''}`.replace(/\/+$/, '')
    const bucket = `${config.bucket || ''}`.replace(/^\/+|\/+$/g, '')
    const normalizedKey = `${key || ''}`.replace(/^\/+/, '')

    if (!base) {
      return normalizedKey
    }

    if (config.forcePathStyle === false) {
      const url = new URL(base)
      url.hostname = bucket ? `${bucket}.${url.hostname}` : url.hostname
      const basePath = url.pathname.replace(/\/+$/, '')
      url.pathname = [basePath, normalizedKey]
        .filter(Boolean)
        .join('/')
        .replace(/^([^/])/, '/$1')
      return url.toString()
    }

    return [base, bucket, normalizedKey].filter(Boolean).join('/')
  }
}
