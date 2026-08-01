// Integração com o Supabase: autenticação (tabela vdv_users via RPC),
// pastas/projetos na nuvem (explorador) e Storage dos arquivos STEP.
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://ostmueibjmhehvcyjzot.supabase.co';
const SUPABASE_KEY = 'sb_publishable_mcDNP-O_Y6JHRdotgoTKEQ_xMGKDvBM';
const BUCKET = 'vdv-projects';

export const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

// ---------------- Autenticação (Supabase Auth) ----------------
function sessionUser(u) {
  if (!u) return null;
  return {
    id: u.id,
    email: u.email,
    display_name: (u.user_metadata && u.user_metadata.display_name) ||
      (u.email || '').split('@')[0]
  };
}

/** @returns {Promise<{id,email,display_name}|null>} null = credenciais inválidas */
export async function cloudLogin(email, password) {
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) {
    if (/invalid login credentials/i.test(error.message)) return null;
    throw new Error(error.message);
  }
  return sessionUser(data.user);
}

/** Sessão persistida (token renovado automaticamente pelo SDK). */
export async function currentUser() {
  const { data } = await sb.auth.getSession();
  return data.session ? sessionUser(data.session.user) : null;
}

export async function cloudLogout() {
  await sb.auth.signOut();
}

// ---------------- Explorador ----------------
export async function listChildren(folderId) {
  const fq = sb.from('vdv_folders').select('*').order('name');
  const pq = sb.from('vdv_projects')
    .select('id, slug, name, folder_id, file_name, size_bytes, saved_by, created_at, updated_at')
    .order('name');
  const [folders, projects] = await Promise.all([
    folderId ? fq.eq('parent_id', folderId) : fq.is('parent_id', null),
    folderId ? pq.eq('folder_id', folderId) : pq.is('folder_id', null)
  ]);
  if (folders.error) throw new Error(folders.error.message);
  if (projects.error) throw new Error(projects.error.message);
  return { folders: folders.data, projects: projects.data };
}

export async function createFolder(name, parentId, username) {
  const { data, error } = await sb.from('vdv_folders')
    .insert({ name, parent_id: parentId, created_by: username })
    .select().single();
  if (error) throw new Error(error.message);
  return data;
}

export async function deleteFolder(id) {
  const { error } = await sb.from('vdv_folders').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

export async function deleteProject(row) {
  await sb.storage.from(BUCKET).remove([row.file_path || row.slug + '.step']);
  const { error } = await sb.from('vdv_projects').delete().eq('id', row.id);
  if (error) throw new Error(error.message);
}

function makeSlug() {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
  let s = '';
  const rnd = crypto.getRandomValues(new Uint8Array(10));
  for (const b of rnd) s += chars[b % chars.length];
  return s;
}

/** Salva projeto: envia o STEP ao Storage e registra os metadados. */
export async function saveProject({ name, folderId, fileName, buffer, state, username }) {
  const slug = makeSlug();
  const filePath = slug + '.step';
  const up = await sb.storage.from(BUCKET).upload(filePath, new Blob([buffer]), {
    upsert: true, contentType: 'application/octet-stream'
  });
  if (up.error) throw new Error('Upload falhou: ' + up.error.message);

  const { data, error } = await sb.from('vdv_projects').insert({
    slug, name, folder_id: folderId, file_name: fileName,
    file_path: filePath, state, size_bytes: buffer.byteLength,
    saved_by: username
  }).select().single();
  if (error) throw new Error(error.message);
  return data;
}

/** Atualiza um projeto existente (sobrescreve arquivo + estado). */
export async function updateProject(row, { buffer, state, username }) {
  const up = await sb.storage.from(BUCKET).upload(row.file_path, new Blob([buffer]), {
    upsert: true, contentType: 'application/octet-stream'
  });
  if (up.error) throw new Error('Upload falhou: ' + up.error.message);
  const { data, error } = await sb.from('vdv_projects')
    .update({ state, size_bytes: buffer.byteLength, saved_by: username })
    .eq('id', row.id).select().single();
  if (error) throw new Error(error.message);
  return data;
}

export async function getProjectBySlug(slug) {
  const { data, error } = await sb.from('vdv_projects')
    .select('*').eq('slug', slug).maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

export async function getFolder(id) {
  const { data, error } = await sb.from('vdv_folders')
    .select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

/** Baixa o conteúdo STEP de um projeto salvo (bucket privado — exige login). */
export async function downloadProjectFile(row) {
  const { data, error } = await sb.storage.from(BUCKET).download(row.file_path);
  if (error) {
    throw new Error('Não foi possível baixar o arquivo do projeto: ' + error.message);
  }
  return await data.arrayBuffer();
}

/** URL compartilhável de um projeto. */
export function shareUrl(slug) {
  const base = location.origin + location.pathname;
  return `${base}#/p/${slug}`;
}
