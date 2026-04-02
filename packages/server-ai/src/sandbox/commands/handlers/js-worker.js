#!/usr/bin/env node

/**
 * Isolated JavaScript Worker Process
 * 
 * This worker runs in a separate process to provide process isolation for JavaScript code execution.
 * It receives code and parameters via stdin and returns the result via stdout.
 * Errors are sent via stderr.
 */

// Resolve module path relative to the worker script location
const path = require('path');

// Try multiple possible paths for isolated-vm module
let Isolate, ExternalCopy;
const possiblePaths = [
        path.join(__dirname, '../../../../node_modules/isolated-vm'),
        path.join(__dirname, '../../node_modules/isolated-vm'),
        path.join(__dirname, '../../../node_modules/isolated-vm'),
        path.join(__dirname, '../../../../..', 'node_modules/isolated-vm'),
        'isolated-vm' // Try default require last
];

for (const modulePath of possiblePaths) {
        try {
                const module = require(modulePath);
                if (module.Isolate && module.ExternalCopy) {
                        Isolate = module.Isolate;
                        ExternalCopy = module.ExternalCopy;
                        break;
                }
        } catch (e) {
                // Continue to next path
        }
}

if (!Isolate || !ExternalCopy) {
        process.stderr.write(`Error: Cannot find isolated-vm module. Tried paths:\n${possiblePaths.join('\n')}\n`);
        process.stderr.write(`Current __dirname: ${__dirname}\n`);
        process.stderr.write(`Current cwd: ${process.cwd()}\n`);
        process.exit(1);
}

async function executeCode() {
        let inputData = '';
        let outputData = '';
        let errorData = '';

        // Read input from stdin
        process.stdin.on('data', (chunk) => {
                inputData += chunk;
        });

        process.stdin.on('end', async () => {
                try {
                        const { code, parameters } = JSON.parse(inputData);

                        // Create isolated environment
                        const isolate = new Isolate({ memoryLimit: 128 }); // 128MB memory limit
                        const contextified = await isolate.createContext();
                        const jail = contextified.global;

                        // Bind user variables to sandbox
                        for (const [key, value] of Object.entries(parameters || {})) {
                                await jail.set(key, new ExternalCopy(value).copyInto());
                        }

                        // Execute code wrapped to return JSON string
                        const wrappedCode = `JSON.stringify((() => { \n${code}\n })())`;
                        const script = await isolate.compileScript(wrappedCode);
                        const result = await script.run(contextified);

                        // Output result
                        const parsedResult = JSON.parse(result);
                        outputData = JSON.stringify({ result: parsedResult });
                        process.stdout.write(outputData);
                        
                        process.exit(0);
                } catch (error) {
                        errorData = error.message || String(error);
                        process.stderr.write(errorData);
                        process.exit(1);
                }
        });
}

// Handle unexpected errors
process.on('uncaughtException', (error) => {
        process.stderr.write(error.message || String(error));
        process.exit(1);
});

process.on('unhandledRejection', (reason) => {
        process.stderr.write(String(reason));
        process.exit(1);
});

executeCode();
