-- Run these statements in your Supabase SQL editor (Project → SQL)

-- users table
CREATE TABLE IF NOT EXISTS public.users (
  id SERIAL PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  role TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  email TEXT UNIQUE,
  firstname TEXT,
  lastname TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- reports table
CREATE TABLE IF NOT EXISTS public.reports (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  codename TEXT,
  grade TEXT NOT NULL,
  type TEXT NOT NULL,
  description TEXT NOT NULL,
  status TEXT DEFAULT 'Pending',
  date DATE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Example: grant the anon role only SELECT/INSERT on reports (configure in Supabase policies as needed)
