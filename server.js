// server.js
require('dotenv').config();

const express = require('express');
const path = require('path');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const session = require('express-session');
const axios = require('axios');

const app = express();

/* ------------------------ Config ------------------------ */
const PORT = process.env.PORT || 3000;
const API_BASE = process.env.API_BASE || 'http://localhost:8080/api/v1';
const SESSION_SECRET = process.env.SESSION_SECRET || 'super-secret';
const isProd = process.env.NODE_ENV === 'production';

/* Axios client către backend */
const api = axios.create({
  baseURL: API_BASE,
  headers: { 'Content-Type': 'application/json' }
});

/* --------------------- Middlewares ---------------------- */
if (!isProd) {
  // Live reload în dev (opțional)
  const connectLivereload = require('connect-livereload');
  const livereload = require('livereload');
  app.use(connectLivereload());
  const lrserver = livereload.createServer({
    exts: ['ejs', 'css', 'js', 'png', 'jpg', 'svg', 'webp'],
    delay: 200
  });
  lrserver.watch(path.join(__dirname, 'views'));
  lrserver.watch(path.join(__dirname, 'public'));
}

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(
  helmet({
    contentSecurityPolicy: false, // simplificat pt. dev/CDN-uri
  })
);
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());
app.use(
  session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'lax' }
  })
);
app.use(express.static(path.join(__dirname, 'public')));

/* Locals pt. view-uri */
app.use((req, res, next) => {
  res.locals.isLogged = !!req.session.token;
  res.locals.user = req.session.user || null;
  res.locals.path = req.path;
  next();
});

/* Auth gate */
function requireAuth(req, res, next) {
  if (req.session?.token) return next();
  req.session.afterLogin = req.originalUrl;
  return res.redirect('/login');
}

/* --------------------- Rute publice --------------------- */
app.get('/login', (req, res) => {
  if (req.session.token) return res.redirect('/');
  res.render('login', {
    title: 'Login',
    error: null,
    email: req.session.lastEmail || ''
  });
});

app.post('/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const { data } = await api.post('/auth/login', { email, password });
    if (!data?.token) throw new Error('Missing token from API');

    req.session.token = data.token;
    req.session.user = data.user || { email };
    req.session.lastEmail = email;

    const redirectTo = req.session.afterLogin || '/';
    delete req.session.afterLogin;
    return res.redirect(redirectTo);
  } catch (err) {
    req.session.lastEmail = '';
    const msg = err.response?.data?.message || err.message || 'Credențiale invalide';
    return res
      .status(401)
      .render('login', { title: 'Login', error: msg, email: '' });
  }
});

app.get('/register', (req, res) => {
  if (req.session.token) return res.redirect('/');
  res.render('register', { title: 'Înregistrare', message: null, error: null });
});

app.post('/register', async (req, res) => {
  const { email, password } = req.body;
  try {
    await api.post('/auth/register', { email, password });
    res.render('register', {
      title: 'Înregistrare',
      message: 'Cont creat! Te poți autentifica.',
      error: null
    });
  } catch (err) {
    const msg = err.response?.data?.message || 'Eroare la crearea contului';
    res
      .status(400)
      .render('register', { title: 'Înregistrare', message: null, error: msg });
  }
});

app.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

/* --------- Gate: protejează TOT ce urmează (exceptând public) --------- */
/* exclude /login, /register, /favicon.ico; static e scos deja prin express.static */
app.use(/^\/(?!login|register|favicon\.ico).*/, requireAuth);

/* -------------------- Rute protejate (app) -------------------- */
app.get('/', (req, res) => {
  res.render('home', { title: 'Direcționare 20%' });
});

app.get('/voluntari', (req, res) => {
  res.render('voluntari', { title: 'Voluntari', heading: 'Voluntari' });
});

app.get('/formulare',  (req, res) => res.render('stub', { title: 'Formulare', heading: 'Formulare' }));
app.get('/donatii',    (req, res) => res.render('stub', { title: 'Donații',    heading: 'Donații'    }));
app.get('/proiecte',   (req, res) => res.render('stub', { title: 'Proiecte',   heading: 'Proiecte'   }));
app.get('/cazuri',     (req, res) => res.render('stub', { title: 'Cazuri',     heading: 'Cazuri'     }));
app.get('/rapoarte',   (req, res) => res.render('stub', { title: 'Rapoarte',   heading: 'Rapoarte'   }));
app.get('/setari',     (req, res) => res.render('stub', { title: 'Setări',     heading: 'Setări'     }));
app.get('/dashboard',  (req, res) => res.render('dashboard', { title: 'Dashboard' }));

/* -------------------- PROXY spre Spring (ATAȘEAZĂ token) -------------------- */
const proxyVoluntari = async (req, res) => {
  if (!req.session?.token) {
    return res.status(401).json({ message: 'Not authenticated' });
  }
  try {
    // debug util: vezi în server logs ce cere FE
    console.log('[proxy] ->', `${API_BASE}/volunteers`, 'query:', req.query);

    const { data, status } = await api.get('/volunteers', {
      params: req.query, // forward page,size,sort,q...
      headers: { Authorization: `Bearer ${req.session.token}` }
    });
    return res.status(status).json(data);
  } catch (err) {
    const status = err.response?.status || 500;
    const payload = err.response?.data || { message: 'Upstream error' };
    return res.status(status).json(payload);
  }
};

// preferat
app.get('/api/voluntari', proxyVoluntari);

// alias — ca să funcționeze și dacă FE încă cere /api/v1/volunteers
app.get('/api/v1/volunteers', proxyVoluntari);


/* ------------------------- 404 handler ------------------------- */
app.use((req, res) => {
  res.status(404).render('404', { title: '404' });
});

/* -------------------------- Start app -------------------------- */
app.listen(PORT, () => {
  console.log(`FE running on http://localhost:${PORT}`);
});
