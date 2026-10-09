export default ({ env }) => ({
  auth: {
    secret: env('ADMIN_JWT_SECRET', 'test-admin-jwt-secret'),
  },
  apiToken: {
    salt: env('API_TOKEN_SALT', 'test-api-token-salt'),
  },
  transfer: {
    token: {
      salt: env('TRANSFER_TOKEN_SALT', 'test-transfer-token-salt'),
    },
  },
  secrets: {
    encryptionKey: env('ENCRYPTION_KEY', 'test-encryption-key-min-16chars'),
  },
  rateLimit: {
    enabled: false,
  },
});
