const express = require('express');
const path = require('path');
const fs = require('fs').promises;
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3000;

// Supabase configuration (service role key kept server-side)
const SUPABASE_URL = 'https://ibxftgmhpiwjopnujoqi.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlieGZ0Z21ocGl3am9wbnVqb3FpIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MDkxODY3MCwiZXhwIjoyMDg2NDk0NjcwfQ.4WFv4WFYVk8GZ31GTNi17qr21tEMmB511kFIL2E2aR0';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const DB_PATH = path.join(__dirname, 'data', 'db.json');

// Helper: read db.json
async function readDb() {
  try {
    const data = await fs.readFile(DB_PATH, 'utf8');
    if (!data || !data.trim()) {
      return { users: [], reports: [] };
    }
    return JSON.parse(data);
  } catch (err) {
    console.error('Error reading db.json:', err);
    return { users: [], reports: [] };
  }
}

// Helper: write db.json
async function writeDb(data) {
  try {
    await fs.mkdir(path.dirname(DB_PATH), { recursive: true });
    await fs.writeFile(DB_PATH, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error('Error writing db.json:', err);
    throw err;
  }
}

app.use(express.json());
app.use(cors());
// simple request logger to help debug 405s and routing issues
app.use((req, res, next) => {
  console.log(new Date().toISOString(), req.method, req.originalUrl);
  next();
});

app.use(express.static(__dirname)); // serve static frontend files from project root

// Helper: detect missing table/schema error from Supabase and return friendly guidance
function handleSupabaseError(err, res){
  console.error(err);
  // PostgREST / Supabase error when table doesn't exist
  if(err && (err.code === 'PGRST205' || (err.message && err.message.includes('Could not find the table')))){
    return res.status(500).json({ error: "Supabase schema missing: run 'supabase-schema.sql' in your Supabase SQL editor to create required tables." });
  }
  return res.status(500).json({ error: err.message || 'Server error' });
}

// --- Auth ---
app.post('/api/login', async (req, res) => {
  const { username, password, role } = req.body;
  if(!username || !password || !role) return res.status(400).json({ error: 'Missing credentials' });

  try{
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('username', username)
      .eq('role', role)
      .limit(1)
      .single();

    if(error) return res.status(404).json({ error: 'Account not found' });
    const user = data;
    if(user.password !== password) return res.status(401).json({ error: 'Incorrect password' });
    // approval removed: allow users to sign in regardless of `status`

    res.json({ id: user.id, username: user.username, role: user.role });
  }catch(err){
    return handleSupabaseError(err, res);
  }
});

app.post('/api/signup', async (req, res) => {
  const { role, firstname, lastname, username, email, password } = req.body;
  if(!role || !firstname || !lastname || !username || !email || !password) return res.status(400).json({ error: 'Missing fields' });

  try{
    // check uniqueness
    const { data: existing } = await supabase.from('users').select('id').or(`username.eq.${username},email.eq.${email}`).limit(1);
    if(existing && existing.length) return res.status(409).json({ error: 'Username or email already exists' });

    // remove manual approval — mark all new signups as approved
    const status = 'approved';
    const roleNormalized = role === 'teacher' ? 'teacher' : (role === 'student' ? 'student' : 'parent');

    const { data, error } = await supabase.from('users').insert([{
      username,
      password,
      role: roleNormalized,
      status,
      email,
      firstname,
      lastname
    }]).select().single();

    if(error) throw error;
    res.status(201).json({ message: 'Account created', user: { id: data.id, username: data.username, role: data.role, status: data.status } });
  }catch(err){
    return handleSupabaseError(err, res);
  }
});

// --- Reports ---
app.get('/api/reports', async (req, res) => {
  try{
    const { data, error } = await supabase.from('reports').select('*').order('id', { ascending: true });
    if(error) throw error;
    res.json(data || []);
  }catch(err){
    return handleSupabaseError(err, res);
  }
});

// --- Users (admin) ---
app.get('/api/users', async (req, res) => {
  try{
    const { data, error } = await supabase
      .from('users')
      .select('id,username,role,status,email,firstname,lastname,created_at')
      .order('id', { ascending: true });
    if(error) throw error;
    res.json(data || []);
  }catch(err){
    console.error(err);
    res.status(500).json({ error: 'Failed to load users' });
  }
});

// explicit 405 handlers for unsupported methods on API endpoints
app.all('/api/signup', (req, res, next) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });
  next();
});

app.all('/api/login', (req, res, next) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });
  next();
});

app.all('/api/users', (req, res, next) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method Not Allowed' });
  next();
});

app.all('/api/reports', (req, res, next) => {
  if (!['GET','POST'].includes(req.method)) return res.status(405).json({ error: 'Method Not Allowed' });
  next();
});

app.all('/api/reports/:id/solve', (req, res, next) => {
  if (req.method !== 'PUT') return res.status(405).json({ error: 'Method Not Allowed' });
  next();
});

app.post('/api/reports', async (req, res) => {
  // accept either casing from different clients (name / Name, codename / Codename, etc.)
  const { Name, name, Grade, grade, Type, type, Description, description, Date, date, Codename, codename } = req.body || {};

  const nameVal = Name || name;
  const codenameVal = Codename || codename || null;
  const gradeVal = Grade || grade;
  const typeVal = Type || type;
  const descVal = Description || description;
  const dateVal = Date || date;

  if (!nameVal || !gradeVal || !typeVal || !descVal || !dateVal) return res.status(400).json({ error: 'Missing required fields' });

  try{
    const { data, error } = await supabase.from('reports').insert([{
      name: nameVal,
      codename: codenameVal,
      grade: gradeVal,
      type: typeVal,
      description: descVal,
      status: 'Pending',
      date: dateVal
    }]).select().single();

    if(error) throw error;
    res.status(201).json(data);
  }catch(err){
    return handleSupabaseError(err, res);
  }
});

app.put('/api/reports/:id/solve', async (req, res) => {
  const id = Number(req.params.id);
  try{
    const { data, error } = await supabase.from('reports').update({ status: 'Solved' }).eq('id', id).select().single();
    if(error) return res.status(404).json({ error: 'Report not found' });
    res.json(data);
  }catch(err){
    console.error(err);
    res.status(500).json({ error: 'Failed to update report' });
  }
});

// fallback for unknown API paths
app.use('/api', (req,res) => res.status(404).json({ error: 'API route not found' }));

app.listen(PORT, () => console.log(`SWDSMS backend running at http://localhost:${PORT}`));
