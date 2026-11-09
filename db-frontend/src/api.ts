const API_URL = import.meta.env.VITE_API_URL || `${window.location.protocol}//${window.location.hostname}:3000`

export type User = { id: string; name: string; email: string; role: 'admin' | 'doctor' | 'staff' }
export type Appointment = {
  id: string
  bookingCode: string
  patientName: string
  phone: string
  type: string
  typeId: string
  date: string
  startAt: string
  endAt: string
  durationMinutes: number
  sessionId: string
  status: string
  source: string
  note: string
}
export type DashboardData = {
  clinic: { name: string; doctorName: string; timezone: string; bookingsOpen: boolean; dailyCap: number }
  date: string
  appointments: Appointment[]
  metrics: { appointments: number; pending: number; completed: number; newPatients: number }
  types: { id: string; name: string; durationMinutes: number; feePaise: number }[]
}
export type Patient = { id: string; name: string; phone: string; language: string; flagged: boolean; noShowCount: number; notes: string; visits: number }
export type ScheduleData = { rules: { weekday: number; isWorking: boolean; sessions: { id: string; name: string; start: string; end: string; mode: string; slotMinutes: number; sessionCap: number; bufferMinutes: number }[] }[]; exceptions: { _id: string; type: string; startDate: string; endDate: string; reason?: string }[]; timezone: string }
export type Settings = { id: string; clinicName: string; doctorName: string; address: string; clinicPhone: string; timezone: string; bookingsOpen: boolean; confirmationMode: string; dailyCap: number; minNoticeMinutes: number; maxAdvanceDays: number; holdMinutes: number; greeting: string; reminderHours: number[] }

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = localStorage.getItem('careflow_token')
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...init.headers },
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(body.error || 'Something went wrong.')
  return body as T
}

export async function login(email: string, password: string) {
  const result = await request<{ token: string; user: User }>('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) })
  localStorage.setItem('careflow_token', result.token)
  return result.user
}
export async function me() { return (await request<{ user: User }>('/api/auth/me')).user }
export async function getOverview(date: string) { return request<DashboardData>(`/api/dashboard/overview?date=${date}`) }
export async function createAppointment(input: { patientName: string; phone: string; typeId: string; date: string; startAt: string; note?: string }) { return request<{ appointment: Appointment }>('/api/dashboard/appointments', { method: 'POST', body: JSON.stringify(input) }) }
export async function updateAppointmentStatus(id: string, status: string) { return request<{ appointment: Appointment }>(`/api/dashboard/appointments/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }) }
export async function getAppointments(date?: string) { return request<{ date: string; appointments: Appointment[] }>(`/api/dashboard/appointments${date ? `?date=${date}` : '?all=true'}`) }
export async function getPatients(query = '') { return request<{ patients: Patient[] }>(`/api/dashboard/patients${query ? `?q=${encodeURIComponent(query)}` : ''}`) }
export async function getPatient(id: string) { return request<{ patient: Patient; appointments: Appointment[] }>(`/api/dashboard/patients/${id}`) }
export async function getSchedule() { return request<ScheduleData>('/api/dashboard/schedule') }
export async function getSettings() { return request<{ settings: Settings }>('/api/dashboard/settings') }
export async function updateSettings(settings: Partial<Settings>) { return request<{ settings: Settings }>('/api/dashboard/settings', { method: 'PATCH', body: JSON.stringify(settings) }) }
export async function createException(input: { type: string; startDate: string; endDate: string; startTime?: string; endTime?: string; dailyCap?: number; reason?: string }) { return request('/api/dashboard/schedule/exceptions', { method: 'POST', body: JSON.stringify(input) }) }
export function logout() { localStorage.removeItem('careflow_token') }
