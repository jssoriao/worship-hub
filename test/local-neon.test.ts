import { afterEach, describe, expect, it } from 'vitest'
import { isLocalDb, localProxy, routeLocalDb } from '../src/shared/local-neon.ts'

const fresh = () => ({ wsProxy: undefined as unknown, useSecureWebSocket: true, pipelineTLS: true, pipelineConnect: 'password' as false | 'password' })

describe('isLocalDb', () => {
  it('is true only for URLs on this machine', () => {
    expect(isLocalDb('postgres://u:p@localhost:5432/db')).toBe(true)
    expect(isLocalDb('postgres://u:p@127.0.0.1:5432/db')).toBe(true)
    expect(isLocalDb('postgres://u:p@[::1]:5432/db')).toBe(true)
  })

  it('is false for hosted databases and anything unclear', () => {
    expect(isLocalDb('postgres://u:p@ep-example-123.eu-west-2.aws.neon.tech/db')).toBe(false)
    // a host that merely starts with "localhost" is not this machine
    expect(isLocalDb('postgres://u:p@localhost.example.com/db')).toBe(false)
    expect(isLocalDb('postgres://u:p@example.com/localhost')).toBe(false)
    expect(isLocalDb('not a url')).toBe(false)
    expect(isLocalDb('')).toBe(false)
    expect(isLocalDb(undefined)).toBe(false)
  })
})

describe('routeLocalDb', () => {
  afterEach(() => {
    delete process.env.LOCAL_DB_PROXY_PORT
  })

  it('points the driver at the local proxy, without TLS, when a URL is local', () => {
    const config = fresh()
    routeLocalDb(config, 'postgres://u:p@localhost:5432/db')
    expect(typeof config.wsProxy).toBe('function')
    expect((config.wsProxy as () => string)()).toBe('localhost:5433/v1?address=postgres:5432')
    expect(config.useSecureWebSocket).toBe(false)
    expect(config.pipelineTLS).toBe(false)
    expect(config.pipelineConnect).toBe(false)
  })

  it('leaves the driver alone for hosted databases', () => {
    const config = fresh()
    routeLocalDb(config, 'postgres://u:p@ep-example-123.eu-west-2.aws.neon.tech/db', undefined)
    expect(config).toEqual(fresh())
  })

  it('treats the setup as local when any of the URLs is', () => {
    const config = fresh()
    routeLocalDb(config, 'postgres://u:p@ep-example-123.neon.tech/db', 'postgres://u:p@localhost:5432/db')
    expect(config.useSecureWebSocket).toBe(false)
  })
})

describe('localProxy', () => {
  afterEach(() => {
    delete process.env.LOCAL_DB_PROXY_PORT
  })

  it('uses port 5433 unless LOCAL_DB_PROXY_PORT says otherwise', () => {
    expect(localProxy()).toBe('localhost:5433/v1?address=postgres:5432')
    process.env.LOCAL_DB_PROXY_PORT = '5444'
    expect(localProxy()).toBe('localhost:5444/v1?address=postgres:5432')
  })

  it('ignores a value that is not a port, so nothing odd ends up in the address', () => {
    for (const bad of ['abc', '5433/evil', '5433?address=other:5432', '1', '123456', ' 5444']) {
      process.env.LOCAL_DB_PROXY_PORT = bad
      expect(localProxy()).toBe('localhost:5433/v1?address=postgres:5432')
    }
  })
})
