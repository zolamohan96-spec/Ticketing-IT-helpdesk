const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const dataDir = path.join(__dirname, 'data');
const dataFile = path.join(dataDir, 'users.json');

function hashPassword(password, salt) {
  return crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
}

function generateSalt() {
  return crypto.randomBytes(16).toString('hex');
}

function safeUser(user) {
  if (!user) return null;
  const { passwordHash, salt, ...safe } = user;
  return safe;
}

function now() {
  return new Date().toISOString();
}

function createDefaultUsers() {
  const adminSalt = generateSalt();
  const userSalt = generateSalt();
  const timestamp = now();

  return [
    {
      id: 'USR-1001',
      username: process.env.ADMIN_USERNAME || 'admin',
      name: 'Administrator',
      email: 'admin@helpdesk.local',
      role: 'admin',
      salt: adminSalt,
      passwordHash: hashPassword(process.env.ADMIN_PASSWORD || 'Admin@12345', adminSalt),
      createdAt: timestamp,
      updatedAt: timestamp
    },
    {
      id: 'USR-1002',
      username: process.env.USER_USERNAME || 'user',
      name: 'Pengguna Standar',
      email: 'user@helpdesk.local',
      role: 'user',
      salt: userSalt,
      passwordHash: hashPassword(process.env.USER_PASSWORD || 'User@12345', userSalt),
      createdAt: timestamp,
      updatedAt: timestamp
    }
  ];
}

function ensureStore() {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  if (!fs.existsSync(dataFile)) {
    fs.writeFileSync(dataFile, JSON.stringify(createDefaultUsers(), null, 2), 'utf8');
  }
}

function read() {
  ensureStore();
  try {
    const content = fs.readFileSync(dataFile, 'utf8');
    return JSON.parse(content);
  } catch (err) {
    const defaults = createDefaultUsers();
    fs.writeFileSync(dataFile, JSON.stringify(defaults, null, 2), 'utf8');
    return defaults;
  }
}

function write(users) {
  ensureStore();
  fs.writeFileSync(dataFile, JSON.stringify(users, null, 2), 'utf8');
}

function nextId(users) {
  const max = users.reduce((highest, user) => {
    const num = Number((user.id || '').replace('USR-', '')) || 1000;
    return Math.max(highest, num);
  }, 1000);
  return `USR-${max + 1}`;
}

const userStore = {
  all(filters = {}) {
    let users = read().map(safeUser);
    if (filters.role) {
      users = users.filter(u => u.role === filters.role);
    }
    if (filters.q) {
      const q = filters.q.toLowerCase();
      users = users.filter(u =>
        [u.id, u.username, u.name, u.email, u.role].join(' ').toLowerCase().includes(q)
      );
    }
    return users.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  },

  find(id) {
    const users = read();
    const user = users.find(u => u.id === id);
    return safeUser(user);
  },

  findByUsername(username) {
    if (!username) return null;
    const users = read();
    return users.find(u => u.username.toLowerCase() === username.trim().toLowerCase()) || null;
  },

  authenticate(username, password) {
    if (!username || typeof password !== 'string') return null;
    const user = this.findByUsername(username);
    if (!user) return null;

    const testHash = hashPassword(password, user.salt);
    const hashBuffer = Buffer.from(user.passwordHash, 'hex');
    const testBuffer = Buffer.from(testHash, 'hex');

    if (hashBuffer.length === testBuffer.length && crypto.timingSafeEqual(hashBuffer, testBuffer)) {
      return safeUser(user);
    }
    return null;
  },

  create(input) {
    const username = (input.username || '').trim();
    const name = (input.name || '').trim();
    const email = (input.email || '').trim();
    const role = input.role === 'admin' ? 'admin' : 'user';
    const password = input.password;

    if (!username || !name || !password) {
      throw new Error('Username, nama lengkap, dan password wajib diisi.');
    }

    if (username.length < 3) {
      throw new Error('Username minimal 3 karakter.');
    }

    if (!/^[a-zA-Z0-9_.-]+$/.test(username)) {
      throw new Error('Username hanya boleh berisi huruf, angka, titik, underscore, atau tanda hubung.');
    }

    if (password.length < 6) {
      throw new Error('Password minimal 6 karakter.');
    }

    if (this.findByUsername(username)) {
      throw new Error(`Username "${username}" sudah digunakan.`);
    }

    const users = read();
    const salt = generateSalt();
    const timestamp = now();
    const newUser = {
      id: nextId(users),
      username,
      name,
      email,
      role,
      salt,
      passwordHash: hashPassword(password, salt),
      createdAt: timestamp,
      updatedAt: timestamp
    };

    users.push(newUser);
    write(users);
    return safeUser(newUser);
  },

  delete(id, currentUserId) {
    const users = read();
    const targetIndex = users.findIndex(u => u.id === id);
    if (targetIndex === -1) {
      throw new Error('Pengguna tidak ditemukan.');
    }

    const targetUser = users[targetIndex];

    if (targetUser.id === currentUserId) {
      throw new Error('Anda tidak dapat menghapus akun Anda sendiri yang sedang aktif.');
    }

    if (targetUser.username.toLowerCase() === 'admin') {
      throw new Error('Akun admin utama sistem tidak dapat dihapus.');
    }

    users.splice(targetIndex, 1);
    write(users);
    return true;
  },

  update(id, input, currentUserId) {
    const users = read();
    const targetIndex = users.findIndex(u => u.id === id);
    if (targetIndex === -1) {
      throw new Error('Pengguna tidak ditemukan.');
    }

    const targetUser = users[targetIndex];
    const name = (input.name || '').trim();
    const email = (input.email || '').trim();
    const role = input.role === 'admin' ? 'admin' : 'user';
    const password = input.password;

    if (!name) {
      throw new Error('Nama lengkap wajib diisi.');
    }

    // Protect main admin role from being demoted to user
    if (targetUser.username.toLowerCase() === 'admin' && role !== 'admin') {
      throw new Error('Peran akun admin utama sistem harus tetap Administrator.');
    }

    targetUser.name = name;
    targetUser.email = email;
    targetUser.role = role;
    if (input.avatar) {
      targetUser.avatar = input.avatar;
    } else if (input.removeAvatar === 'true') {
      targetUser.avatar = null;
    }
    targetUser.updatedAt = now();

    // If password provided, update hash and salt
    if (password && password.trim()) {
      if (password.length < 6) {
        throw new Error('Password baru minimal 6 karakter.');
      }
      const newSalt = generateSalt();
      targetUser.salt = newSalt;
      targetUser.passwordHash = hashPassword(password, newSalt);
    }

    users[targetIndex] = targetUser;
    write(users);
    return safeUser(targetUser);
  },

  updateProfile(id, input) {
    const users = read();
    const targetIndex = users.findIndex(u => u.id === id);
    if (targetIndex === -1) {
      throw new Error('Pengguna tidak ditemukan.');
    }

    const targetUser = users[targetIndex];
    const name = (input.name || '').trim();
    const email = (input.email || '').trim();
    const oldPassword = input.oldPassword;
    const newPassword = input.newPassword;

    if (!name) {
      throw new Error('Nama lengkap wajib diisi.');
    }

    // If new password is provided, verify old password
    if (newPassword && newPassword.trim()) {
      if (!oldPassword) {
        throw new Error('Password saat ini (lama) wajib diisi untuk mengganti password.');
      }
      const testHash = hashPassword(oldPassword, targetUser.salt);
      const hashBuffer = Buffer.from(targetUser.passwordHash, 'hex');
      const testBuffer = Buffer.from(testHash, 'hex');

      if (hashBuffer.length !== testBuffer.length || !crypto.timingSafeEqual(hashBuffer, testBuffer)) {
        throw new Error('Password saat ini (lama) salah.');
      }

      if (newPassword.length < 6) {
        throw new Error('Password baru minimal 6 karakter.');
      }

      const newSalt = generateSalt();
      targetUser.salt = newSalt;
      targetUser.passwordHash = hashPassword(newPassword, newSalt);
    }

    targetUser.name = name;
    targetUser.email = email;
    if (input.avatar) {
      targetUser.avatar = input.avatar;
    } else if (input.removeAvatar === 'true') {
      targetUser.avatar = null;
    }
    targetUser.updatedAt = now();

    users[targetIndex] = targetUser;
    write(users);
    return safeUser(targetUser);
  },

  stats() {
    const users = read();
    return {
      total: users.length,
      adminCount: users.filter(u => u.role === 'admin').length,
      userCount: users.filter(u => u.role === 'user').length
    };
  }
};

module.exports = userStore;
