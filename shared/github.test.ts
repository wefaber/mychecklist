import { describe, expect, test } from 'bun:test'
import {
  githubKey,
  githubRefOfLink,
  isValidRef,
  normalizeRef,
  parseGithubUrl,
} from './github'

const ISSUE = 'https://github.com/wefaber/mychecklist/issues/12'

describe('parseGithubUrl', () => {
  test('reconoce issues y PRs', () => {
    expect(parseGithubUrl(ISSUE)).toEqual({
      owner: 'wefaber',
      repo: 'mychecklist',
      number: 12,
    })
    expect(parseGithubUrl('https://github.com/oven-sh/bun/pull/1234')).toEqual({
      owner: 'oven-sh',
      repo: 'bun',
      number: 1234,
    })
  })

  test('acepta www, barra final, fragmento y query', () => {
    for (const url of [
      'https://www.github.com/wefaber/mychecklist/issues/12',
      `${ISSUE}/`,
      `${ISSUE}#issuecomment-99`,
      `${ISSUE}?notification_referrer_id=x`,
    ])
      expect(parseGithubUrl(url)?.number).toBe(12)
  })

  test('un PR acepta sus pestañas, un issue no', () => {
    const pr = 'https://github.com/wefaber/mychecklist/pull/7'
    for (const tab of ['files', 'commits', 'checks'])
      expect(parseGithubUrl(`${pr}/${tab}`)?.number).toBe(7)
    expect(parseGithubUrl(`${pr}/commits/abc123`)).toBeNull()
    expect(parseGithubUrl(`${pr}/files/extra`)).toBeNull()
    expect(parseGithubUrl(`${ISSUE}/files`)).toBeNull()
  })

  test('no es un chip lo que no es issue ni PR', () => {
    for (const url of [
      'https://github.com/wefaber/mychecklist',
      'https://github.com/wefaber/mychecklist/issues',
      'https://github.com/wefaber/mychecklist/issues/new',
      'https://github.com/wefaber/mychecklist/pulls',
      'https://github.com/wefaber/mychecklist/commit/abc',
      'https://github.com/wefaber/mychecklist/tree/main',
      'https://github.com/wefaber/mychecklist/discussions/3',
      'https://github.com/wefaber/mychecklist/issues/0',
      'https://github.com/wefaber/mychecklist/issues/012',
      'https://github.com/wefaber/mychecklist/issues/1e3',
      'https://github.com/wefaber/mychecklist/issues/-4',
      'https://github.com/wefaber/mychecklist/issues/1234567890',
    ])
      expect(parseGithubUrl(url)).toBeNull()
  })

  test('solo https y solo github.com', () => {
    for (const url of [
      'http://github.com/wefaber/mychecklist/issues/12',
      'https://github.com.evil.test/wefaber/mychecklist/issues/12',
      'https://evil-github.com/wefaber/mychecklist/issues/12',
      'https://gist.github.com/wefaber/mychecklist/issues/12',
      'https://github.example.com/wefaber/mychecklist/issues/12',
      'https://user:pass@github.com/wefaber/mychecklist/issues/12',
      'https://github.com:8443/wefaber/mychecklist/issues/12',
      'javascript:alert(1)',
      'ftp://github.com/wefaber/mychecklist/issues/12',
      'github.com/wefaber/mychecklist/issues/12',
      '',
      'no es una url',
    ])
      expect(parseGithubUrl(url)).toBeNull()
  })

  test('dueño y repo con forma válida', () => {
    expect(parseGithubUrl('https://github.com/-lead/repo/issues/1')).toBeNull()
    expect(parseGithubUrl('https://github.com/a/../issues/1')).toBeNull()
    expect(
      parseGithubUrl('https://github.com/own%20er/repo/issues/1'),
    ).toBeNull()
    expect(
      parseGithubUrl(`https://github.com/${'a'.repeat(40)}/repo/issues/1`),
    ).toBeNull()
    expect(parseGithubUrl('https://github.com/a/my.repo_x-1/issues/1')).toEqual(
      {
        owner: 'a',
        repo: 'my.repo_x-1',
        number: 1,
      },
    )
  })
})

describe('githubRefOfLink', () => {
  test('es chip si el texto es la URL, aunque lleve espacios alrededor', () => {
    expect(githubRefOfLink(ISSUE, ISSUE)?.number).toBe(12)
    expect(githubRefOfLink(ISSUE, ` ${ISSUE} `)?.number).toBe(12)
  })

  test('no es chip si la persona escribió otro texto', () => {
    expect(githubRefOfLink(ISSUE, 'ver el issue')).toBeNull()
    expect(githubRefOfLink(ISSUE, 'wefaber/mychecklist#12')).toBeNull()
  })

  test('un texto con forma de URL de GitHub sobre otro destino no es chip', () => {
    expect(
      githubRefOfLink('https://evil.test/x', 'https://evil.test/x'),
    ).toBeNull()
  })
})

describe('claves', () => {
  test('mayúsculas y minúsculas dan la misma clave', () => {
    const a = parseGithubUrl(
      'https://github.com/WeFaber/MyChecklist/issues/12',
    )!
    expect(githubKey(a)).toBe('wefaber/mychecklist#12')
    expect(normalizeRef(a)).toEqual({
      owner: 'wefaber',
      repo: 'mychecklist',
      number: 12,
    })
  })

  test('isValidRef rechaza lo que el parser no dejaría pasar', () => {
    expect(isValidRef({ owner: 'a', repo: 'b', number: 1 })).toBe(true)
    expect(isValidRef({ owner: 'a b', repo: 'b', number: 1 })).toBe(false)
    expect(isValidRef({ owner: 'a', repo: '..', number: 1 })).toBe(false)
    expect(isValidRef({ owner: 'a', repo: 'b', number: 0 })).toBe(false)
    expect(isValidRef({ owner: 'a', repo: 'b', number: 1.5 })).toBe(false)
  })
})
