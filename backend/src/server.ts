import 'tsconfig-paths/register';
import 'dotenv/config';
import { server } from './app';
import { envParser } from './lib/envParser';

try {
  const host = envParser.NODE_ENV === 'development' ? '127.0.0.1' : '0.0.0.0';
  const { PORT } = envParser;
  server.listen(PORT, () => console.log(`Server started on ${host}:${PORT}`));
} catch (err) {
  console.error('Server failed to start:', err);
  process.exit(1);
}

export default server;
