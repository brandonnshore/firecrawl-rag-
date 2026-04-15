import { createClient } from '@/lib/supabase/server'

export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return new Response('Unauthorized', { status: 401 })
  }

  const { data: site } = await supabase
    .from('sites')
    .select('id')
    .eq('user_id', user.id)
    .maybeSingle()

  if (!site) {
    return new Response('No site found', { status: 404 })
  }

  const { data: leads } = await supabase
    .from('leads')
    .select('name, email, message, source_page, created_at')
    .eq('site_id', site.id)
    .order('created_at', { ascending: false })

  const headers = ['Name', 'Email', 'Message', 'Source Page', 'Date']
  const rows = (leads || []).map((l) =>
    [
      escapeCSV(l.name || ''),
      escapeCSV(l.email),
      escapeCSV(l.message || ''),
      escapeCSV(l.source_page || ''),
      escapeCSV(
        l.created_at ? new Date(l.created_at).toLocaleDateString() : ''
      ),
    ].join(',')
  )

  const csv = [headers.join(','), ...rows].join('\n')

  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': 'attachment; filename="leads.csv"',
    },
  })
}

function escapeCSV(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}
