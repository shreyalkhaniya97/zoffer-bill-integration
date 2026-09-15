// One-time helper: exchanges the short-lived "Generate Code" grant token from
// the Zoho API console for a long-lived refresh token.
//
// Usage:
//   node scripts/exchangeZohoToken.js <GENERATED_CODE>
//
// Reads ZOHO_CLIENT_ID / ZOHO_CLIENT_SECRET / ZOHO_ACCOUNTS_URL from .env,
// prints the refresh_token so you can paste it into .env yourself.

require('dotenv').config();
const axios = require('axios');

const code = process.argv[2];
if (!code) {
  console.error('Usage: node scripts/exchangeZohoToken.js <GENERATED_CODE>');
  process.exit(1);
}

const ACCOUNTS_URL = process.env.ZOHO_ACCOUNTS_URL || 'https://accounts.zoho.in';

async function main() {
  const { data } = await axios.post(`${ACCOUNTS_URL}/oauth/v2/token`, null, {
    params: {
      grant_type: 'authorization_code',
      client_id: process.env.ZOHO_CLIENT_ID,
      client_secret: process.env.ZOHO_CLIENT_SECRET,
      code,
    },
  });

  console.log('\nSuccess. Add this line to your .env:\n');
  console.log(`ZOHO_REFRESH_TOKEN=${data.refresh_token}\n`);
}

main().catch((err) => {
  console.error('Token exchange failed:', err.response?.data || err.message);
  process.exit(1);
});
