// Small illustrative slice of Indian GST rate/HSN rules, hand-curated for this
// prototype. NOT the full CBIC HSN master (that's thousands of codes and
// changes via periodic notifications) - see README "Known limitations".
module.exports = [
  { hsnCode: '8471', description: 'Computers, laptops and peripherals', gstRate: 18 },
  { hsnCode: '8517', description: 'Mobile phones and telecom equipment', gstRate: 18 },
  { hsnCode: '4820', description: 'Office stationery: registers, notebooks, files', gstRate: 12 },
  { hsnCode: '9983', description: 'Professional, technical and business consulting services', gstRate: 18 },
  { hsnCode: '9973', description: 'Leasing or rental services without operator', gstRate: 18 },
  { hsnCode: '8443', description: 'Printers, scanners and printing machinery', gstRate: 18 },
  { hsnCode: '4901', description: 'Printed books', gstRate: 0 },
  { hsnCode: '3926', description: 'Plastic office/household articles', gstRate: 18 },
  { hsnCode: '8504', description: 'Chargers, adapters, power supply units', gstRate: 18 },
  { hsnCode: '9984', description: 'Telecommunication, internet and broadcasting services', gstRate: 18 },
  { hsnCode: '9963', description: 'Accommodation, hotel and restaurant services', gstRate: 12 },
  { hsnCode: '0000-EXEMPT', description: 'Unregistered / exempt supply', gstRate: 0 },
];
