import { Test, TestingModule } from '@nestjs/testing'
import { Cache } from 'cache-manager'
import { SandboxVMHandler } from './vm.handler'

describe('SandboxVMHandler', () => {
	let handler: SandboxVMHandler
	let cacheManager: Cache

	beforeEach(async () => {
		const module: TestingModule = await Test.createTestingModule({
			providers: [
				SandboxVMHandler,
				{
					provide: CACHE_MANAGER,
					useValue: {
						get: jest.fn(),
						set: jest.fn(),
					},
				},
			],
		}).compile()

		handler = module.get<SandboxVMHandler>(SandboxVMHandler)
		cacheManager = module.get<Cache>(CACHE_MANAGER)
	})

	afterEach(() => {
		jest.clearAllMocks()
	})

	describe('runJavaScriptCode', () => {
		it('should execute simple JavaScript code and return result', async () => {
			const parameters = { a: 1, b: 2 }
			const code = 'return a + b'

			const result = await handler.runJavaScriptCode(parameters, code)

			expect(result).toEqual({
				result: 3,
			})
		})

		it('should execute JavaScript code with complex return value', async () => {
			const parameters = { name: 'test' }
			const code = 'return { greeting: `Hello, ${name}!`, count: 42 }'

			const result = await handler.runJavaScriptCode(parameters, code)

			expect(result).toEqual({
				result: {
					greeting: 'Hello, test!',
					count: 42,
				},
			})
		})

		it('should handle empty parameters', async () => {
			const parameters = {}
			const code = 'return 42'

			const result = await handler.runJavaScriptCode(parameters, code)

			expect(result).toEqual({
				result: 42,
			})
		})

		it('should handle code with multiple statements', async () => {
			const parameters = { x: 5, y: 3 }
			const code = `
				const sum = x + y
				const product = x * y
				return { sum, product }
			`

			const result = await handler.runJavaScriptCode(parameters, code)

			expect(result).toEqual({
				result: {
					sum: 8,
					product: 15,
				},
			})
		}, 10000) // Increased timeout for worker process

		it('should timeout on infinite loop', async () => {
			const parameters = {}
			const code = 'while (true) {}'

			await expect(handler.runJavaScriptCode(parameters, code)).rejects.toThrow(
				'JavaScript execution timeout'
			)
		}, 10000)

		it('should handle syntax errors', async () => {
			const parameters = {}
			const code = 'invalid syntax here'

			await expect(handler.runJavaScriptCode(parameters, code)).rejects.toThrow()
		})

		it('should handle runtime errors', async () => {
			const parameters = {}
			const code = 'throw new Error("Test error")'

			await expect(handler.runJavaScriptCode(parameters, code)).rejects.toThrow()
		})
	})

	describe('execute', () => {
		it('should execute JavaScript code', async () => {
			const command = {
				code: 'return a + b',
				parameters: { a: 1, b: 2 },
				language: 'javascript' as const,
			}

			const result = await handler.execute(command)

			expect(result).toEqual({
				result: 3,
			})
		})

		it('should execute Python code', async () => {
			const command = {
				code: 'return a + b',
				parameters: { a: 1, b: 2 },
				language: 'python' as const,
			}

			const result = await handler.execute(command)

			expect(result).toBeDefined()
			// Python execution is tested in python.test.ts
		})

		it('should throw error for unsupported language', async () => {
			const command = {
				code: 'test',
				parameters: {},
				language: 'invalid' as any,
			}

			await expect(handler.execute(command)).rejects.toThrow('Unsupported language invalid')
		})
	})
})
