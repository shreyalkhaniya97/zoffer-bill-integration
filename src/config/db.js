const mongoose = require('mongoose');

async function connectDB() {
  const uri = process.env.MONGO_URI || 'mongodb://localhost:27017/zoffer_bills';
  await mongoose.connect(uri);
  console.log(`[mongo] connected -> ${uri}`);
}

module.exports = { connectDB };
