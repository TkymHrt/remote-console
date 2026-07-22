import { describe, expect, it } from 'vite-plus/test'

import { loadConfig } from './config'

describe('loadConfig', () => {
  it('keeps the fixed target values in validated server configuration', () => {
    const config = loadConfig({
      NODE_ENV: 'test',
      ACCESS_JWT_MODE: 'disabled',
      TARGET_IP: '192.168.11.3',
      TARGET_MAC: '9c:6b:00:94:06:8a',
      RDP_PORT: '3389',
      RDP_URL: 'https://rdp.example.test/rdp/fixed-target',
    })

    expect(config.target).toEqual({
      name: '自宅PC',
      ip: '192.168.11.3',
      mac: '9C:6B:00:94:06:8A',
      rdpPort: 3389,
      rdpUrl: 'https://rdp.example.test/rdp/fixed-target',
    })
  })

  it('requires Access JWT verification settings by default in production', () => {
    expect(() => loadConfig({ NODE_ENV: 'production' })).toThrow()

    const config = loadConfig({
      NODE_ENV: 'production',
      ACCESS_TEAM_DOMAIN: 'example.cloudflareaccess.com',
      ACCESS_AUD: 'fixed-application-audience',
    })
    expect(config.access).toEqual({
      mode: 'required',
      teamDomain: 'example.cloudflareaccess.com',
      audience: 'fixed-application-audience',
    })
  })

  it('rejects malformed network targets and non-HTTPS RDP URLs', () => {
    expect(() =>
      loadConfig({
        NODE_ENV: 'test',
        ACCESS_JWT_MODE: 'disabled',
        TARGET_IP: 'not-an-ip',
      }),
    ).toThrow()
    expect(() =>
      loadConfig({
        NODE_ENV: 'test',
        ACCESS_JWT_MODE: 'disabled',
        RDP_URL: 'http://rdp.example.test/rdp/fixed-target',
      }),
    ).toThrow('RDP_URL must use HTTPS')
  })
})
