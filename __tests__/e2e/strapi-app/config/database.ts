import path from 'node:path';

const depth = __dirname.includes(path.join('dist', 'config')) ? 2 : 1;
const steps = Array.from({ length: depth }, () => '..');

export default ({ env }) => ({
  connection: {
    client: 'sqlite',
    connection: {
      filename: path.join(__dirname, ...steps, env('DATABASE_FILENAME', '.tmp/data.db')),
    },
    useNullAsDefault: true,
  },
});
