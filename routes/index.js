const router = require('express').Router();
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const store = require('../ticketStore');
const userStore = require('../userStore');

const uploadDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
const imageTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const upload = multer({
  storage: multer.diskStorage({
    destination: uploadDir,
    filename: (req, file, cb) => cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(file.originalname).toLowerCase()}`)
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => imageTypes.has(file.mimetype) ? cb(null, true) : cb(new Error('INVALID_IMAGE'))
});

function attachmentFromFile(file) {
  return file ? { originalName: file.originalname, filename: file.filename, mimeType: file.mimetype, size: file.size, url: `/uploads/${file.filename}` } : null;
}

function uploadError(req, res, err, redirect) {
  if (!err) return false;
  req.flash('message', { type: 'danger', text: 'Lampiran harus berupa foto JPG, PNG, WEBP, atau GIF maksimal 5 MB.' });
  res.redirect(redirect);
  return true;
}

function requireAdmin(req, res, next) {
  if (!req.session.user) {
    return res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
  }
  if (req.session.user.role !== 'admin') {
    req.flash('message', { type: 'danger', text: 'Akses ditolak. Anda memerlukan hak akses Administrator untuk membuka halaman ini.' });
    return res.redirect('/');
  }
  next();
}

// Download Android APK Route
router.get('/download/apk', (req, res) => {
  const apkPath = path.join(__dirname, '..', 'HelpdeskCentral.apk');
  const fallbackApk = path.join(__dirname, '..', 'android-app', 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
  if (fs.existsSync(apkPath)) {
    return res.download(apkPath, 'HelpdeskCentral.apk');
  } else if (fs.existsSync(fallbackApk)) {
    return res.download(fallbackApk, 'HelpdeskCentral.apk');
  }
  req.flash('message', { type: 'warning', text: 'File APK belum siap atau sedang dikompilasi.' });
  res.redirect('/login');
});

// Authentication Routes
router.get('/login', (req, res) => {
  if (req.session.user) return res.redirect('/');
  res.render('auth/login', { error: null, next: req.query.next || '/' });
});

router.post('/auth/login', (req, res) => {
  const nextPath = typeof req.body.next === 'string' && req.body.next.startsWith('/') ? req.body.next : '/';
  const authenticatedUser = userStore.authenticate(req.body.username, req.body.password);
  if (!authenticatedUser) {
    return res.status(401).render('auth/login', { error: 'Username atau password salah.', next: nextPath });
  }
  req.session.user = {
    id: authenticatedUser.id,
    username: authenticatedUser.username,
    name: authenticatedUser.name,
    email: authenticatedUser.email,
    role: authenticatedUser.role,
    avatar: authenticatedUser.avatar || null
  };
  res.redirect(nextPath);
});

router.post('/auth/logout', (req, res) => req.session.destroy(() => res.redirect('/login')));

// User Own Profile Routes (Accessible by all logged in users)
router.get('/profile', (req, res) => {
  const currentUser = req.session.user;
  const user = userStore.find(currentUser.id);
  if (!user) {
    req.flash('message', { type: 'danger', text: 'Data profil pengguna tidak ditemukan.' });
    return res.redirect('/');
  }
  res.render('users/profile', {
    title: 'Profil Saya',
    user,
    values: user,
    error: null
  });
});

router.post('/profile', (req, res) => {
  upload.single('avatar')(req, res, (err) => {
    if (uploadError(req, res, err, '/profile')) return;

    const currentUser = req.session.user;
    const user = userStore.find(currentUser.id);
    if (!user) {
      req.flash('message', { type: 'danger', text: 'Data profil pengguna tidak ditemukan.' });
      return res.redirect('/');
    }

    const { name, email, oldPassword, newPassword, confirmPassword, removeAvatar } = req.body;
    const avatar = req.file ? `/uploads/${req.file.filename}` : null;

    if (newPassword && newPassword !== confirmPassword) {
      return res.status(400).render('users/profile', {
        title: 'Profil Saya',
        user,
        values: { ...user, name, email },
        error: 'Konfirmasi password baru tidak cocok.'
      });
    }

    try {
      const updated = userStore.updateProfile(currentUser.id, {
        name,
        email,
        oldPassword,
        newPassword,
        avatar,
        removeAvatar
      });

      req.session.user.name = updated.name;
      req.session.user.email = updated.email;
      req.session.user.avatar = updated.avatar;

      req.flash('message', {
        type: 'success',
        text: 'Profil dan foto akun Anda berhasil diperbarui.'
      });
      res.redirect('/profile');
    } catch (err) {
      res.status(400).render('users/profile', {
        title: 'Profil Saya',
        user,
        values: { ...user, name, email },
        error: err.message
      });
    }
  });
});

// User Management Routes (Admin Only)
router.get('/users', requireAdmin, (req, res) => {
  const users = userStore.all(req.query);
  const stats = userStore.stats();
  res.render('users/index', {
    title: 'Kelola Pengguna',
    users,
    stats,
    filters: req.query
  });
});

router.get('/users/new', requireAdmin, (req, res) => {
  res.render('users/new', {
    title: 'Tambah Pengguna Baru',
    values: {},
    error: null
  });
});

router.post('/users', requireAdmin, (req, res) => {
  const { username, name, email, role, password, confirmPassword } = req.body;

  if (password !== confirmPassword) {
    return res.status(400).render('users/new', {
      title: 'Tambah Pengguna Baru',
      values: req.body,
      error: 'Konfirmasi password tidak cocok.'
    });
  }

  try {
    const newUser = userStore.create({
      username,
      name,
      email,
      role,
      password
    });
    req.flash('message', {
      type: 'success',
      text: `Pengguna "${newUser.username}" (${newUser.role === 'admin' ? 'Administrator' : 'User'}) berhasil ditambahkan.`
    });
    res.redirect('/users');
  } catch (err) {
    res.status(400).render('users/new', {
      title: 'Tambah Pengguna Baru',
      values: req.body,
      error: err.message
    });
  }
});

router.get('/users/:id/edit', requireAdmin, (req, res) => {
  const targetUser = userStore.find(req.params.id);
  if (!targetUser) {
    req.flash('message', { type: 'danger', text: 'Pengguna tidak ditemukan.' });
    return res.redirect('/users');
  }
  res.render('users/edit', {
    title: `Edit Pengguna: ${targetUser.username}`,
    user: targetUser,
    values: targetUser,
    error: null
  });
});

router.post('/users/:id/edit', requireAdmin, (req, res) => {
  upload.single('avatar')(req, res, (err) => {
    if (uploadError(req, res, err, `/users/${req.params.id}/edit`)) return;

    const targetUser = userStore.find(req.params.id);
    if (!targetUser) {
      req.flash('message', { type: 'danger', text: 'Pengguna tidak ditemukan.' });
      return res.redirect('/users');
    }

    const { name, email, role, password, confirmPassword, removeAvatar } = req.body;
    const avatar = req.file ? `/uploads/${req.file.filename}` : null;

    if (password && password !== confirmPassword) {
      return res.status(400).render('users/edit', {
        title: `Edit Pengguna: ${targetUser.username}`,
        user: targetUser,
        values: { ...targetUser, name, email, role },
        error: 'Konfirmasi password baru tidak cocok.'
      });
    }

    try {
      const updated = userStore.update(req.params.id, { name, email, role, password, avatar, removeAvatar }, req.session.user.id);
      
      // If the admin edited their own active account, update the session
      if (req.session.user.id === updated.id) {
        req.session.user.name = updated.name;
        req.session.user.email = updated.email;
        req.session.user.role = updated.role;
        req.session.user.avatar = updated.avatar;
      }

      req.flash('message', {
        type: 'success',
        text: `Data pengguna "${updated.username}" berhasil diperbarui.`
      });
      res.redirect('/users');
    } catch (err) {
      res.status(400).render('users/edit', {
        title: `Edit Pengguna: ${targetUser.username}`,
        user: targetUser,
        values: { ...targetUser, name, email, role },
        error: err.message
      });
    }
  });
});

router.post('/users/:id/delete', requireAdmin, (req, res) => {
  try {
    userStore.delete(req.params.id, req.session.user.id);
    req.flash('message', { type: 'success', text: 'Pengguna berhasil dihapus.' });
  } catch (err) {
    req.flash('message', { type: 'danger', text: err.message });
  }
  res.redirect('/users');
});

// Ticket Routes (with role & user isolation + queue notification)
router.get('/', (req, res) => {
  const currentUser = req.session.user;
  const stats = store.stats(currentUser);
  const userTickets = store.all({}, currentUser);
  const recent = userTickets.filter(ticket => !["Resolved", "Closed"].includes(ticket.status)).slice(0, 5);

  res.render('tickets/dashboard', {
    title: 'Dashboard',
    stats,
    recent,
    currentUser
  });
});

router.get('/tickets/history', (req, res) => {
  const currentUser = req.session.user;
  const userTickets = store.all({}, currentUser);
  const resolvedTickets = userTickets.filter(ticket => ['Resolved', 'Closed'].includes(ticket.status));

  res.render('tickets/history', {
    title: 'Riwayat Terselesaikan',
    tickets: resolvedTickets,
    currentUser
  });
});

router.get('/tickets', (req, res) => {
  const currentUser = req.session.user;
  const tickets = store.all(req.query, currentUser);

  res.render('tickets/index', {
    title: 'Semua Tiket',
    tickets,
    filters: req.query,
    statuses: store.statuses,
    priorities: store.priorities,
    currentUser
  });
});

router.get('/tickets/new', (req, res) => {
  const currentUser = req.session.user || {};
  res.render('tickets/new', {
    title: 'Buat Tiket',
    values: {
      requester: currentUser.name || currentUser.username || '',
      email: currentUser.email || ''
    },
    categories: ['Hardware', 'Software', 'Network', 'Access', 'Account', 'Other'],
    priorities: store.priorities,
    currentUser
  });
});

router.post('/tickets', (req, res, next) => {
  upload.single('attachment')(req, res, (err) => {
    if (uploadError(req, res, err, '/tickets/new')) return;
    next();
  });
}, (req, res) => {
  if (!req.body.title || !req.body.description) {
    req.flash('message', { type: 'danger', text: 'Judul dan detail masalah wajib diisi.' });
    return res.redirect('/tickets/new');
  }

  const currentUser = req.session.user;
  const ticket = store.create({
    ...req.body,
    requester: req.body.requester || (currentUser ? currentUser.name : 'User'),
    email: req.body.email || (currentUser ? currentUser.email : ''),
    attachment: attachmentFromFile(req.file)
  }, currentUser);

  const queueInfo = store.getQueueInfo(ticket.id);
  const queueMsg = queueInfo && queueInfo.inQueue ? ` (Antrean #${queueInfo.position})` : '';

  req.flash('message', {
    type: 'success',
    text: `Tiket ${ticket.id} berhasil dibuat${queueMsg}. Tim IT akan segera menindaklanjuti laporan Anda.`
  });
  res.redirect(`/tickets/${ticket.id}`);
});

router.get('/tickets/:id', (req, res) => {
  const ticket = store.find(req.params.id);
  if (!ticket) return res.status(404).render('main/notfound');

  const currentUser = req.session.user;
  if (!store.canAccess(ticket, currentUser)) {
    req.flash('message', {
      type: 'danger',
      text: 'Akses ditolak. Anda hanya dapat melihat tiket milik akun Anda sendiri.'
    });
    return res.redirect('/tickets');
  }

  const queueInfo = store.getQueueInfo(ticket.id);

  res.render('tickets/show', {
    title: ticket.id,
    ticket,
    queueInfo,
    statuses: store.statuses,
    priorities: store.priorities,
    currentUser
  });
});

router.post('/tickets/:id/update', (req, res, next) => {
  upload.single('resolutionPhoto')(req, res, (err) => {
    if (uploadError(req, res, err, `/tickets/${req.params.id}`)) return;
    next();
  });
}, (req, res) => {
  const existingTicket = store.find(req.params.id);
  if (!existingTicket) return res.status(404).render('main/notfound');

  const currentUser = req.session.user;
  if (!store.canAccess(existingTicket, currentUser)) {
    req.flash('message', { type: 'danger', text: 'Akses ditolak. Anda tidak memiliki izin mengubah tiket ini.' });
    return res.redirect('/tickets');
  }

  // Only admin can change technical status, priority, and assignee
  const updatePayload = currentUser.role === 'admin'
    ? req.body
    : {};

  const ticket = store.update(req.params.id, updatePayload);
  if (!ticket) return res.status(404).render('main/notfound');

  if (req.body.noteText && req.body.noteText.trim()) {
    const authorName = currentUser.role === 'admin'
      ? (req.body.noteAuthor || currentUser.name || 'Support IT')
      : (currentUser.name || currentUser.username || 'User');
    store.addNote(req.params.id, { author: authorName, text: req.body.noteText });
  }

  if (req.file && currentUser.role === 'admin') {
    store.setResolutionAttachment(req.params.id, attachmentFromFile(req.file));
  }

  req.flash('message', { type: 'success', text: `Perubahan tiket ${ticket.id} berhasil disimpan.` });
  res.redirect(`/tickets/${ticket.id}`);
});

router.post('/tickets/:id/resolution-photo', (req, res, next) => {
  upload.single('resolutionPhoto')(req, res, (err) => {
    if (uploadError(req, res, err, `/tickets/${req.params.id}`) || !req.file) return;
    next();
  });
}, (req, res) => {
  const existingTicket = store.find(req.params.id);
  if (!existingTicket) return res.status(404).render('main/notfound');

  const currentUser = req.session.user;
  if (!store.canAccess(existingTicket, currentUser) || currentUser.role !== 'admin') {
    req.flash('message', { type: 'danger', text: 'Akses ditolak.' });
    return res.redirect(`/tickets/${req.params.id}`);
  }

  const ticket = store.setResolutionAttachment(req.params.id, attachmentFromFile(req.file));
  if (ticket) req.flash('message', { type: 'success', text: `Bukti penyelesaian untuk ${ticket.id} berhasil dilampirkan.` });
  res.redirect(`/tickets/${req.params.id}`);
});

router.post('/tickets/:id/notes', (req, res) => {
  const existingTicket = store.find(req.params.id);
  if (!existingTicket) return res.status(404).render('main/notfound');

  const currentUser = req.session.user;
  if (!store.canAccess(existingTicket, currentUser)) {
    req.flash('message', { type: 'danger', text: 'Akses ditolak.' });
    return res.redirect('/tickets');
  }

  if (req.body.text && req.body.text.trim()) {
    const authorName = currentUser.name || currentUser.username || 'Pengguna';
    store.addNote(req.params.id, { author: authorName, text: req.body.text });
  }
  res.redirect(`/tickets/${req.params.id}`);
});

router.use((req, res) => res.status(404).render('main/notfound'));

module.exports = router;
