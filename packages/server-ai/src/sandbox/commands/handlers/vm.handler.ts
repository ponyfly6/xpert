import { CACHE_MANAGER } from '@nestjs/cache-manager'
import { Inject, Logger } from '@nestjs/common'
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs'
import { Cache } from 'cache-manager'
import { spawn } from 'child_process'
import { join } from 'path'
import { SandboxVMCommand } from '../vm.command'
import { runPythonFunction } from './python'

@CommandHandler(SandboxVMCommand)
export class SandboxVMHandler implements ICommandHandler<SandboxVMCommand> {
        readonly #logger = new Logger(SandboxVMHandler.name)

        constructor(
                @Inject(CACHE_MANAGER)
                private readonly cacheManager: Cache,
        ) {}

        public async execute(command: SandboxVMCommand) {
                const { code, parameters, language } = command
                if (language === 'javascript') {
                        return await this.runJavaScriptCode(parameters, code)
                } else if (language === 'python') {
                        return await runPythonFunction(parameters, code)
                }

                throw new Error(`Unsupported language ${language}`)
        }

        async runJavaScriptCode(parameters: any, code: string): Promise<any> {
                return new Promise((resolve, reject) => {
                        // Spawn worker process for JavaScript execution
                        // Set NODE_PATH to include isolated-vm module location
                        const env = { ...process.env, NODE_PATH: process.env.NODE_PATH || '' }

                        const workerPath = join(__dirname, 'js-worker.js')
                        const jsProcess = spawn('node', [workerPath], {
                                stdio: ['pipe', 'pipe', 'pipe'],
                                env
                        })

                        let output = ''
                        let errorOutput = ''

                        // Send code and parameters to worker
                        const payload = JSON.stringify({ code, parameters })
                        jsProcess.stdin.write(payload)
                        jsProcess.stdin.end()

                        // Collect output from worker
                        jsProcess.stdout.on('data', (data) => {
                                output += data.toString()
                        })

                        // Collect error messages
                        jsProcess.stderr.on('data', (data) => {
                                errorOutput += data.toString()
                        })

                        // Timeout protection - kill worker if execution takes too long
                        const timeout = setTimeout(() => {
                                jsProcess.kill('SIGKILL')
                                reject(new Error('JavaScript execution timeout'))
                        }, 5000) // 5 seconds timeout (consistent with Python)

                        // Handle worker process completion
                        jsProcess.on('close', (code) => {
                                clearTimeout(timeout)
                                if (code === 0) {
                                        try {
                                                const result = JSON.parse(output)
                                                resolve(result)
                                        } catch (e) {
                                                // If not valid JSON, return as-is
                                                resolve({ result: output })
                                        }
                                } else {
                                        reject(new Error(errorOutput || 'JavaScript execution failed'))
                                }
                        })

                        // Handle worker process errors
                        jsProcess.on('error', (error) => {
                                clearTimeout(timeout)
                                reject(new Error(`Failed to spawn JavaScript worker: ${error.message}`))
                        })
                })
        }
}
