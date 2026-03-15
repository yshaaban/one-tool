import { spawn } from 'node:child_process';
import path from 'node:path';

const ROOT_DIR = path.resolve('.');
const DRIVER_PATH = path.join(ROOT_DIR, 'python', 'tests', 'differential_driver.py');

export async function runPythonDifferentialDriver<TRequest, TResponse>(request: TRequest): Promise<TResponse> {
  return new Promise<TResponse>(function (resolve, reject): void {
    const stdoutChunks: Uint8Array[] = [];
    const stderrChunks: Uint8Array[] = [];
    const child = spawn('python3', [DRIVER_PATH], {
      cwd: ROOT_DIR,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    child.once('error', reject);
    child.stdout.on('data', function (chunk: Uint8Array): void {
      stdoutChunks.push(chunk);
    });
    child.stderr.on('data', function (chunk: Uint8Array): void {
      stderrChunks.push(chunk);
    });
    child.stdin.on('error', function (caught: NodeJS.ErrnoException): void {
      if (caught.code !== 'EPIPE') {
        reject(caught);
      }
    });
    child.once('close', function (code): void {
      if (code !== 0) {
        const stderr = Buffer.concat(stderrChunks).toString('utf8');
        reject(new Error(stderr.trim() || `python differential driver exited with code ${code}`));
        return;
      }

      try {
        const stdout = Buffer.concat(stdoutChunks).toString('utf8');
        resolve(JSON.parse(stdout) as TResponse);
      } catch (caught) {
        reject(caught);
      }
    });

    child.stdin.end(JSON.stringify(request));
  });
}
