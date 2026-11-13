/* MGEO PDF – configuração do servidor de login (Supabase)
   Supabase → Project Settings → API: copie "Project URL" e a chave "anon public".
   A chave anon é pública por natureza; quem protege os dados são as regras do banco (schema.sql). */
window.MGEO_CONFIG = {
  supabaseUrl: 'https://SEU-PROJETO.supabase.co',
  supabaseAnonKey: 'COLE_AQUI_A_CHAVE_ANON_PUBLIC',
  otpChannel: 'whatsapp',   // 'whatsapp' ou 'sms'
  offlineDays: 30           // dias que o app funciona sem internet depois do último login online
};
