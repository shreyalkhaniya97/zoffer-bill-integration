const axios = require('axios');

const ACCOUNTS_URL = process.env.ZOHO_ACCOUNTS_URL || 'https://accounts.zoho.in';
const API_DOMAIN = process.env.ZOHO_API_DOMAIN || 'https://www.zohoapis.in';
const ORG_ID = process.env.ZOHO_ORG_ID;

let cachedToken = null; // { accessToken, expiresAt }
let cachedExpenseAccountId = null;

async function getAccessToken() {
  if (cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.accessToken;

  const { data } = await axios.post(`${ACCOUNTS_URL}/oauth/v2/token`, null, {
    params: {
      refresh_token: process.env.ZOHO_REFRESH_TOKEN,
      client_id: process.env.ZOHO_CLIENT_ID,
      client_secret: process.env.ZOHO_CLIENT_SECRET,
      grant_type: 'refresh_token',
    },
  });

  cachedToken = {
    accessToken: data.access_token,
    expiresAt: Date.now() + (data.expires_in - 60) * 1000,
  };
  return cachedToken.accessToken;
}

async function zohoRequest(method, path, { params = {}, data } = {}) {
  const accessToken = await getAccessToken();
  const res = await axios({
    method,
    url: `${API_DOMAIN}/books/v3${path}`,
    params: { organization_id: ORG_ID, ...params },
    data,
    headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
  });
  return res.data;
}

async function findOrCreateVendor(vendorName) {
  const name = (vendorName || 'Unknown Vendor').trim();

  const search = await zohoRequest('GET', '/contacts', {
    params: { contact_name: name, contact_type: 'vendor' },
  });
  const existing = search.contacts?.find(
    (c) => c.contact_name.toLowerCase() === name.toLowerCase()
  );
  if (existing) return existing.contact_id;

  const created = await zohoRequest('POST', '/contacts', {
    data: { contact_name: name, contact_type: 'vendor' },
  });
  return created.contact.contact_id;
}

// Bills need a chart-of-accounts expense account per line item. Rather than
// require the caller to pick one, grab any expense-type account and reuse it -
// good enough for a scrappy prototype, not for real bookkeeping.
async function getDefaultExpenseAccountId() {
  if (cachedExpenseAccountId) return cachedExpenseAccountId;

  const { chartofaccounts } = await zohoRequest('GET', '/chartofaccounts', {
    params: { filter_by: 'AccountType.Expense' },
  });
  if (!chartofaccounts?.length) {
    throw new Error('No expense account found in Zoho Books chart of accounts.');
  }
  cachedExpenseAccountId = chartofaccounts[0].account_id;
  return cachedExpenseAccountId;
}

async function createBill(payload) {
  const result = await zohoRequest('POST', '/bills', { data: payload });
  return result.bill;
}

module.exports = { findOrCreateVendor, getDefaultExpenseAccountId, createBill };
