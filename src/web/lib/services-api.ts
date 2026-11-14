/** The active church's services and setlists, through the typed API client. */
import { call, servicesApi } from './api'
export const listServices = () => call(servicesApi.$get())
export type ServiceList = Awaited<ReturnType<typeof listServices>>
export type ServiceSummary = ServiceList['services'][number]
export const getService = (id: string) => call(servicesApi[':serviceId'].$get({ param: { serviceId: id } }))
export type ServiceFull = Awaited<ReturnType<typeof getService>>['service']
export type ServiceItem = ServiceFull['items'][number]
export const createService = (input: { date: string; time?: string | null; title?: string | null; notes?: string | null }) => call(servicesApi.$post({ json: input }))
export const updateService = (id: string, patch: { date?: string; time?: string | null; title?: string | null; notes?: string | null }) =>
  call(servicesApi[':serviceId'].$patch({ param: { serviceId: id }, json: patch }))
export const cloneService = (id: string, input: { date: string; time?: string | null }) => call(servicesApi[':serviceId'].clone.$post({ param: { serviceId: id }, json: input }))
export const deleteService = (id: string) => call(servicesApi[':serviceId'].$delete({ param: { serviceId: id } }))
/** One line sent when saving the setlist: a church song, a song to add to the list, or a plain line. */
export interface ItemDraft {
  id?: string
  kind: 'song' | 'item' | 'header'
  songId?: string | null
  newSong?: { title: string; artist?: string | null; key?: string | null }
  title?: string | null
  key: string | null
  notes: string | null
  links: { url: string; label: string }[]
}
export const saveItems = (id: string, items: ItemDraft[]) => call(servicesApi[':serviceId'].items.$put({ param: { serviceId: id }, json: { items } }))
