# SchoolCare ERP Cloud Edition

## What is included
- `public/index.html`: updated SchoolCare interface (student/parent registration, attendance, records)
- `server.js`: Express backend; Supabase secret stays server-side
- `.env.example`: configuration template

## Requirements
- Node.js 20+ recommended
- Supabase project with the four existing tables: `parents`, `students`, `attendance`, `notifications`

## Run on Windows
1. Extract the ZIP to a normal folder, e.g. `C:\SchoolCareERP`.
2. Install Node.js LTS from https://nodejs.org if not already installed.
3. In that folder, copy `.env.example` and rename the copy to `.env`.
4. Open `.env` in Notepad and fill:
   - `SUPABASE_URL`: your Supabase project URL
   - `SUPABASE_SECRET_KEY`: your Supabase Secret key (server only)
5. Keep all `WA_...` values blank until WhatsApp Cloud API credentials and an approved template are ready.
6. Open Command Prompt in the folder and run:
   ```
   npm install
   npm start
   ```
7. Visit http://localhost:3000

## WhatsApp template requirement
Automatic sending is deliberately disabled until all three are configured on the server:
`WA_ACCESS_TOKEN`, `WA_PHONE_NUMBER_ID`, and `WA_TEMPLATE_NAME`.
The approved WhatsApp template must have exactly three BODY variables in this order:
1. Student name
2. Attendance status
3. Attendance date

Set `WA_TEMPLATE_LANGUAGE` to the approved template language code. Meta may require opt-in and an approved template for business-initiated messages. A successful API response means accepted by Meta, not necessarily delivered; delivery webhooks are a later enhancement.

## Security
- Never put the Supabase Secret key or WhatsApp access token in `public/index.html`.
- Never share `.env` or screenshots showing its values.
- This starter app has no staff login yet. Do not expose it publicly or use it with real student data until staff authentication, role permissions, HTTPS, and audit controls are added.
- RLS is enabled on the tables. The backend uses the Supabase Secret key, which bypasses RLS; protect the server and its environment variables.
- Parent WhatsApp consent is required before registration and notification attempts.
