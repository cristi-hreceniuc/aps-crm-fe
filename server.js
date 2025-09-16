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
const API_BASE = process.env.API_BASE || 'http://localhost:8080/api/v1'; // ex: http://localhost:8080/api/v1
const SESSION_SECRET = process.env.SESSION_SECRET || 'super-secret';
const isProd = process.env.NODE_ENV === 'production';

/* -------------------- Axios client BE ------------------- */
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

app.use((req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  next();
});

/* ------------------------ Auth gate --------------------- */
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
    req.session.lastEmail = email || '';
    const msg = err.response?.data?.message || err.message || 'Credențiale invalide';
    return res
      .status(401)
      .render('login', { title: 'Login', error: msg, email: req.session.lastEmail });
  }
});

app.get('/register', (req, res) => {
  if (!req.session.token) return res.redirect('/login'); // doar logați au voie
  res.render('register', { title: 'Înregistrare', message: null, error: null });
});

app.post('/register', async (req, res) => {
  const { email, password, firstName, lastName, gender } = req.body; // ← noi
  try {
    await api.post('/auth/register', { email, password, firstName, lastName, gender });
    res.render('register', {
      title: 'Înregistrare',
      message: 'Cont creat! Te poți autentifica.',
      error: null
    });
  } catch (err) {
    const msg = err.response?.data?.message || 'Eroare la crearea contului';
    res.status(400).render('register', { title: 'Înregistrare', message: null, error: msg });
  }
});

app.use((req, res, next) => {
  res.locals.isLogged = !!req.session.token;   // true / false
  res.locals.user = req.session.user || null;  // dacă ai user salvat în sesiune
  next();
});


app.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.set('Cache-Control', 'no-store');
    res.redirect('/login');
  });
});

/* --------- Gate: protejează TOT ce urmează (exceptând public) --------- */
/* exclude /login, /register, /favicon.ico; static e scos deja prin express.static */
app.use(/^\/(?!login|register|favicon\.ico).*/, requireAuth);

/* ------------------- Rute pagini (app) ------------------ */
app.get('/',           (req, res) => res.render('home',      { title: 'Direcționare 20%' }));
app.get('/voluntari',  (req, res) => res.render('voluntari', { title: 'Voluntari', heading: 'Voluntari' }));
app.get('/d177', (req, res) => {res.render('d177', { title: 'Declarația 177', heading: 'Declarația 177' });});
app.get('/sponsorizare',   (req, res) => res.render('sponsorizare',      { title: 'Contract sponsorizare',  heading: 'Contract sponsorizare'  }));
app.get('/rapoarte',   (req, res) => res.render('rapoarte',      { title: 'Rapoarte',  heading: 'Rapoarte'  }));
app.get('/setari',     (req, res) => res.render('setari',      { title: 'Setări',    heading: 'Setări'    }));
app.get('/offline-payments',  (req, res) => res.render('offline-payments', { title: 'Plati offline' }));
app.get('/f230', requireAuth, (req,res)=> res.render('f230', { title: 'Formular 230 – Formulare' }));
app.get('/iban-beneficiari', requireAuth, (req,res)=> res.render('iban', { title: 'IBAN Beneficiari' }));
app.get('/cause', (req, res) =>res.render('cause', { title: 'Cauze', heading: 'Cauze' }));
/* ----------------------- Proxy helper ------------------- */
// GET proxy spre Spring, pasează query-urile + Bearer din sesiune
const proxyGet = (targetPath) => async (req, res) => {
  if (!req.session?.token) return res.status(401).json({ message: 'Not authenticated' });
  try {
    const { data, status } = await api.get(targetPath, {
      params: req.query,
      headers: { Authorization: `Bearer ${req.session.token}` }
    });
    return res.status(status).json(data);
  } catch (err) {
    const s = err.response?.status || 500;
    const body = err.response?.data || { message: 'Upstream error' };
    console.error('[proxyGet]', targetPath, '->', s, body);
    return res.status(s).json(body);
  }
};

/* -------------------- Rute proxy API -------------------- */
/* Ambele rute FE mapează la același endpoint BE:
   - când q e gol => listă paginată normală
   - când q are text => căutare în câmpurile permise
*/
app.get('/api/voluntari',        proxyGet('/volunteers/search'));
app.get('/api/voluntari/search', proxyGet('/volunteers/search'));

app.get('/api/d177',        proxyGet('/formulare/d177/search'));
app.get('/api/d177/search', proxyGet('/formulare/d177/search')); // dacă vrei să păstrezi formatul grid-ului

app.get('/api/sponsorizare',         proxyGet('/sponsorizare/search'));
app.get('/api/sponsorizare/search',  proxyGet('/sponsorizare/search'));

app.get('/api/f230',            proxyGet('/f230/search'));
app.get('/api/f230/search',     proxyGet('/f230/search'));

app.get('/api/iban',           proxyGet('/iban/search'));
app.get('/api/iban/search',    proxyGet('/iban/search'));

app.get('/api/kpi',    proxyGet('/kpi'));
app.get('/api/offline-payments',    proxyGet('/offline-payments'));

app.get('/api/settings/xml',    proxyGet('settings/xml'));
/* === Proxy către BE (cu Bearer) === */

const proxyDelete = (targetPathBuilder) => async (req, res) => {
  if (!req.session?.token) return res.status(401).json({ message:'Not authenticated' });
  const targetPath = (typeof targetPathBuilder === 'function') ? targetPathBuilder(req) : targetPathBuilder;
  try {
    const { status, data } = await api.delete(targetPath, {
      headers: { Authorization: `Bearer ${req.session.token}` }
    });
    return status === 204 ? res.status(204).end() : res.status(status).json(data);
  } catch (err) {
    const s = err.response?.status || 500;
    res.status(s).json(err.response?.data || { message:'Upstream error' });
  }
};

// Generate XML borderou (F230)
app.post('/api/f230/borderou', requireAuth, async (req, res) => {
  try {
    const { token } = req.session;
    const { data, headers, status } = await api.post('/f230/borderou', req.body, {
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        'Accept': 'application/xml'
      },
      responseType: 'arraybuffer'  // pentru a forward-a fișierul
    });
    res.set('Content-Type', headers['content-type'] || 'application/xml');
    if (headers['content-disposition']) res.set('Content-Disposition', headers['content-disposition']);
    res.status(status || 200).send(data);
  } catch (e) {
    const s = e.response?.status || 500;
    res.status(s).json({ message: e.response?.data?.message || e.message });
  }
});


app.get('/api/reports/export', async (req, res) => {
  if (!req.session?.token) {
    return res.status(401).json({ message: 'Not authenticated' });
  }
  try {
    const { dataset } = req.query;
    const response = await api.get(`/reports/export`, {
      params: { dataset },
      headers: { Authorization: `Bearer ${req.session.token}` },
      responseType: 'arraybuffer'   // <-- important
    });

    res.setHeader('Content-Disposition', `attachment; filename="${dataset}.csv"`);
    res.setHeader(
      'Content-Type',
      'text/csv; charset=UTF-8'
    );

    res.send(Buffer.from(response.data));   // trimite binar, nu .json()
  } catch (err) {
    console.error('Export proxy error:', err.message);
    res.status(err.response?.status || 500)
       .json(err.response?.data || { message: 'Upstream error at export' });
  }
});


const proxyPut = (pathBuilder) => async (req, res) => {
  if (!req.session?.token) return res.status(401).json({ message: 'Not authenticated' });
  const targetPath = (typeof pathBuilder === 'function') ? pathBuilder(req) : pathBuilder;
  try {
    const { status, data } = await api.put(targetPath, req.body, {
      headers: { Authorization: `Bearer ${req.session.token}` }
    });
    return res.status(status).json(data);
  } catch (err) {
    const s = err.response?.status || 500;
    return res.status(s).json(err.response?.data || { message:'Upstream error' });
  }
};

const proxyPost = (pathBuilder) => async (req, res) => {
  if (!req.session?.token) {
    return res.status(401).json({ message: 'Not authenticated' });
  }

  const targetPath = (typeof pathBuilder === 'function') ? pathBuilder(req) : pathBuilder;

  try {
    const { status, data } = await api.post(targetPath, req.body, {
      headers: { Authorization: `Bearer ${req.session.token}` }
    });
    return res.status(status).json(data);
  } catch (err) {
    console.error('Proxy POST error:', err.message);
    const s = err.response?.status || 500;
    return res.status(s).json(err.response?.data || { message: 'Upstream error' });
  }
};
// --- PROXY API (trimite Bearer spre BE) ---
app.get('/api/cause', async (req, res) => {
  try {
    const { token } = req.session;
    const { data } = await api.get('/cause', {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      params: req.query
    });
    res.json(data);
  } catch (err) {
    const status = err.response?.status || 500;
    res.status(status).json({ message: 'Proxy cause error' });
  }
});

// server.js (sau unde ai celelalte proxy-uri)
const ensureAuth = (req,res,next)=> req.session?.token ? next() : res.status(401).json({message:'Not authenticated'});

// list/search
app.get('/api/offline-payments', async (req,res)=>{
  try{
    const { token } = req.session;
    const { data, status } = await api.get('/offline-payments', {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      params: req.query
    });
    res.status(status).json(data);
  }catch(err){
    res.status(err.response?.status||500).json({message:'Proxy offline-payments error'});
  }
});

// update status
app.put('/api/offline-payments/:id/status', ensureAuth, async (req,res)=>{
  try{
    const { token } = req.session;
    const { id } = req.params;
    const { data, status } = await api.put(`/offline-payments/${id}/status`, req.body, {
      headers: { Authorization: `Bearer ${token}` }
    });
    res.status(status).json(data);
  }catch(err){
    res.status(err.response?.status||500).json(err.response?.data||{message:'Proxy update status error'});
  }
});

// delete
app.delete('/api/offline-payments/:id', ensureAuth, async (req,res)=>{
  try{
    const { token } = req.session;
    const { id } = req.params;
    const { data, status } = await api.delete(`/offline-payments/${id}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    res.status(status).json(data);
  }catch(err){
    res.status(err.response?.status||500).json({message:'Proxy delete offline-payment error'});
  }
});


// rutele proxy (unde ai și GET-urile):
app.delete('/api/voluntari/:id', proxyDelete(req => `/volunteers/${req.params.id}`));
app.delete('/api/d177/:id', proxyDelete(req => `/formulare/d177/${req.params.id}`));
app.delete('/api/f230/:id', proxyDelete(req => `/f230/${req.params.id}`));
app.delete('/api/iban/:id', proxyDelete(req => `/iban/${req.params.id}`));
app.delete('/api/offline-payments/:id', proxyDelete(req => `/offline-payments/${req.params.id}`));
app.delete('/api/sponsorizare/:id', proxyDelete(req => `/sponsorizare/${req.params.id}`));
app.delete('/api/settings/:id', proxyDelete(req => `/settings/${req.params.id}`));

app.put('/api/d177/:id/flags', proxyPut(req => `/formulare/d177/${req.params.id}/flags`));
app.put('/api/f230/:id/flags', proxyPut(req => `/f230/${req.params.id}/flags`));
app.put('/api/sponsorizare/:id/flags', proxyPut(req => `/sponsorizare/${req.params.id}/flags`));
app.put('/api/iban/:id', proxyPut(req => `/iban/${req.params.id}`));
app.put('/api/offline-payments/:id/status', proxyPut(req => `/offline-payments/${req.params.id}/status`));
app.put('/api/settings/:id', proxyPut(req => `/settings/${req.params.id}`));

app.post('/api/settings/:id/reset', proxyPost(req => `/settings/${req.params.id}/reset`));
app.post('/api/iban', proxyPost('/iban'));
app.post('/api/f230/borderou', proxyPost('/f230/borderou'));


/* ------------------------- 404 handler ------------------------- */
app.use((req, res) => {
  res.status(404).render('404', { title: '404' });
});

/* -------------------------- Start app -------------------------- */
app.listen(PORT, () => {
  console.log(`FE running on http://localhost:${PORT}`);
  console.log(`Proxy to BE: ${API_BASE}`);
});

