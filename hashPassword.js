const bcrypt = require('bcrypt');

async function hashPassword(password) {
    const hashedPassword = await bcrypt.hash(password, 10);
    console.log("加密後的密碼:", hashedPassword);
}

hashPassword("password123");
