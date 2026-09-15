const mongoose = require('mongoose');

// Not wired into the flow yet (single hardcoded DEFAULT_ORG_ID for this prototype).
// Kept as the extension point for real multi-tenant auth later.
const OrganizationSchema = new mongoose.Schema(
  {
    orgId: { type: String, required: true, unique: true },
    name: String,
    zohoOrgId: String,
    zohoRefreshToken: String,
  },
  { timestamps: true }
);

module.exports = mongoose.model('Organization', OrganizationSchema);
