const express = require('express');
const path = require('path');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const session = require('express-session');
const flash = require('connect-flash');
const router = require('./routes/index');

const app = express();
app.use(cookieParser('ticketing-secret'));
app.use(session({ secret: 'ticketing-session', resave: false, saveUninitialized: false, cookie: { maxAge: 86400000 } }));
app.use(flash());
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use('/script-adminlte', express.static(path.join(__dirname, 'node_modules/admin-lte')));
app.use(bodyParser.urlencoded({ extended: false }));
app.use((req, res, next) => {
  res.locals.title = 'Helpdesk Central';
  res.locals.currentPath = req.path;
  res.locals.currentUser = req.session.user || null;
  res.locals.flashMessage = req.flash('message')[0];
  next();
});
app.use((req, res, next) => {
  const publicRoute = req.path === '/login' || req.path === '/auth/login' || req.path.startsWith('/download') || req.path.startsWith('/script-adminlte') || req.path.startsWith('/css') || req.path.startsWith('/js');
  if (publicRoute || req.session.user) return next();
  res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
});
app.use('/', router);

const port = process.env.PORT || 3300;
app.listen(port, () => console.log(`Ticketing system running on port ${port}`));
