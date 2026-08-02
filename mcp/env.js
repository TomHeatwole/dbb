// Load mcp/.env relative to this file (not process.cwd()), so the server
// works regardless of where the MCP client launches it from.
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

dotenv.config({ path: join(dirname(fileURLToPath(import.meta.url)), '.env') });
