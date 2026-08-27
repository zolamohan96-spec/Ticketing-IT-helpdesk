const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, 'data');
const dataFile = path.join(dataDir, 'tickets.json');
const statuses = ['Open', 'In Progress', 'Waiting', 'Resolved', 'Closed'];
const priorities = ['Low', 'Medium', 'High', 'Urgent'];

const seedTickets = [
  {
    id: 'TKT-1003',
    userId: 'USR-1002',
    createdBy: 'user',
    title: 'VPN kantor tidak bisa tersambung',
    requester: 'Pengguna Standar',
    email: 'user@helpdesk.local',
    category: 'Network',
    priority: 'High',
    status: 'In Progress',
    assignee: 'Andi Support',
    description: 'VPN terputus sejak pagi dan muncul pesan timeout saat login dari laptop kantor.',
    notes: [{ author: 'Andi Support', text: 'Sedang memeriksa konfigurasi gateway dan akun pengguna.', createdAt: '2026-08-25T08:30:00.000Z' }],
    createdAt: '2026-08-25T07:50:00.000Z',
    updatedAt: '2026-08-25T08:30:00.000Z'
  },
  {
    id: 'TKT-1002',
    userId: 'USR-1002',
    createdBy: 'user',
    title: 'Printer lantai 2 tidak mencetak',
    requester: 'Pengguna Standar',
    email: 'user@helpdesk.local',
    category: 'Hardware',
    priority: 'Medium',
    status: 'Open',
    assignee: '',
    description: 'Dokumen masuk antrean tetapi tidak keluar dari printer ruang operasional.',
    notes: [],
    createdAt: '2026-08-25T07:10:00.000Z',
    updatedAt: '2026-08-25T07:10:00.000Z'
  },
  {
    id: 'TKT-1001',
    userId: 'USR-1001',
    createdBy: 'admin',
    title: 'Permintaan akses folder laporan bulanan',
    requester: 'Administrator',
    email: 'admin@helpdesk.local',
    category: 'Access',
    priority: 'Low',
    status: 'Resolved',
    assignee: 'Raka IT',
    description: 'Mohon akses baca ke folder laporan bulanan untuk kebutuhan rekap.',
    notes: [{ author: 'Raka IT', text: 'Akses baca sudah diberikan. Silakan coba kembali.', createdAt: '2026-08-24T10:20:00.000Z' }],
    createdAt: '2026-08-24T09:40:00.000Z',
    updatedAt: '2026-08-24T10:20:00.000Z'
  }
];

function ensureStore() {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(dataFile)) fs.writeFileSync(dataFile, JSON.stringify(seedTickets, null, 2));
}

function read() {
  ensureStore();
  return JSON.parse(fs.readFileSync(dataFile, 'utf8'));
}

function write(tickets) {
  ensureStore();
  fs.writeFileSync(dataFile, JSON.stringify(tickets, null, 2));
}

function nextId(tickets) {
  const max = tickets.reduce((highest, ticket) => Math.max(highest, Number(ticket.id.replace('TKT-', '')) || 1000), 1000);
  return `TKT-${max + 1}`;
}

function now() {
  return new Date().toISOString();
}

function isUserTicket(ticket, user) {
  if (!user) return true;
  if (user.role === 'admin') return true;
  if (ticket.userId && ticket.userId === user.id) return true;
  if (ticket.createdBy && ticket.createdBy.toLowerCase() === user.username.toLowerCase()) return true;
  if (ticket.requester && ticket.requester.toLowerCase() === user.username.toLowerCase()) return true;
  if (ticket.requester && user.name && ticket.requester.toLowerCase() === user.name.toLowerCase()) return true;
  return false;
}

function attachQueueNumbers(tickets) {
  // Sort active tickets chronologically (FIFO by createdAt) to determine true system queue order
  const activeTickets = tickets
    .filter(t => !['Resolved', 'Closed'].includes(t.status))
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

  const totalActiveQueue = activeTickets.length;
  const queueMap = new Map();
  activeTickets.forEach((ticket, idx) => {
    queueMap.set(ticket.id, idx + 1);
  });

  return tickets.map(ticket => {
    const isFinished = ['Resolved', 'Closed'].includes(ticket.status);
    const queuePosition = isFinished ? null : (queueMap.get(ticket.id) || null);
    return {
      ...ticket,
      queuePosition,
      totalActiveQueue: isFinished ? 0 : totalActiveQueue
    };
  });
}

const ticketStore = {
  statuses,
  priorities,

  all(filters = {}, user = null) {
    let tickets = read();
    tickets = attachQueueNumbers(tickets);

    // Filter by user role if not admin
    if (user && user.role !== 'admin') {
      tickets = tickets.filter(ticket => isUserTicket(ticket, user));
    }

    // Filter by status & priority
    if (filters.status && statuses.includes(filters.status)) {
      tickets = tickets.filter(ticket => ticket.status === filters.status);
    }
    if (filters.priority && priorities.includes(filters.priority)) {
      tickets = tickets.filter(ticket => ticket.priority === filters.priority);
    }
    if (filters.q) {
      const q = filters.q.toLowerCase();
      tickets = tickets.filter(ticket =>
        [ticket.id, ticket.title, ticket.requester, ticket.category, ticket.assignee, ticket.createdBy || ''].join(' ').toLowerCase().includes(q)
      );
    }

    return tickets.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  },

  find(id) {
    const tickets = read();
    const withQueue = attachQueueNumbers(tickets);
    return withQueue.find(ticket => ticket.id === id) || null;
  },

  canAccess(ticket, user) {
    if (!ticket || !user) return false;
    if (user.role === 'admin') return true;
    return isUserTicket(ticket, user);
  },

  getQueueInfo(ticketId) {
    const tickets = read();
    const ticket = tickets.find(t => t.id === ticketId);
    if (!ticket) return null;

    const isFinished = ['Resolved', 'Closed'].includes(ticket.status);
    if (isFinished) {
      return {
        inQueue: false,
        status: ticket.status,
        position: null,
        total: 0,
        message: `Tiket ini telah selesai ditangani (Status: ${ticket.status}).`
      };
    }

    const activeTickets = tickets
      .filter(t => !['Resolved', 'Closed'].includes(t.status))
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

    const posIndex = activeTickets.findIndex(t => t.id === ticketId);
    const position = posIndex !== -1 ? posIndex + 1 : 1;
    const total = activeTickets.length;

    return {
      inQueue: true,
      status: ticket.status,
      position,
      total,
      message: `Tiket ini berada pada urutan antrean ke-${position} dari ${total} tiket aktif dalam antrean sistem.`
    };
  },

  stats(user = null) {
    let tickets = read();
    if (user && user.role !== 'admin') {
      tickets = tickets.filter(ticket => isUserTicket(ticket, user));
    }
    return {
      total: tickets.length,
      active: tickets.filter(t => !['Resolved', 'Closed'].includes(t.status)).length,
      open: tickets.filter(t => t.status === 'Open').length,
      progress: tickets.filter(t => t.status === 'In Progress').length,
      waiting: tickets.filter(t => t.status === 'Waiting').length,
      resolved: tickets.filter(t => ['Resolved', 'Closed'].includes(t.status)).length,
      urgent: tickets.filter(t => t.priority === 'Urgent' && !['Resolved', 'Closed'].includes(t.status)).length
    };
  },

  create(input, user = null) {
    const tickets = read();
    const timestamp = now();
    const requesterName = (input.requester || (user ? (user.name || user.username) : '') || '').trim();
    const requesterEmail = (input.email || (user ? user.email : '') || '').trim();

    const ticket = {
      id: nextId(tickets),
      userId: user ? user.id : null,
      createdBy: user ? user.username : 'system',
      title: input.title.trim(),
      requester: requesterName,
      email: requesterEmail,
      category: input.category || 'Other',
      priority: input.priority || 'Medium',
      status: 'Open',
      assignee: (input.assignee || '').trim(),
      description: input.description.trim(),
      attachment: input.attachment || null,
      notes: [],
      createdAt: timestamp,
      updatedAt: timestamp
    };

    tickets.push(ticket);
    write(tickets);
    return this.find(ticket.id);
  },

  update(id, input) {
    const tickets = read();
    const ticket = tickets.find(item => item.id === id);
    if (!ticket) return null;
    ['status', 'priority', 'assignee'].forEach(key => {
      if (input[key] !== undefined && input[key] !== '') ticket[key] = input[key];
    });
    ticket.updatedAt = now();
    write(tickets);
    return this.find(id);
  },

  setResolutionAttachment(id, attachment) {
    const tickets = read();
    const ticket = tickets.find(item => item.id === id);
    if (!ticket) return null;
    ticket.resolutionAttachment = attachment;
    ticket.updatedAt = now();
    write(tickets);
    return this.find(id);
  },

  addNote(id, input) {
    const tickets = read();
    const ticket = tickets.find(item => item.id === id);
    if (!ticket) return null;
    ticket.notes = ticket.notes || [];
    ticket.notes.push({
      author: (input.author || 'Support').trim(),
      text: input.text.trim(),
      createdAt: now()
    });
    ticket.updatedAt = now();
    write(tickets);
    return this.find(id);
  }
};

module.exports = ticketStore;
