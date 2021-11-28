import { NestFastifyApplication } from '@nestjs/platform-fastify'
import { Testing } from '@defichain/jellyfish-testing'
import { MasterNodeRegTestContainer } from '@defichain/testcontainers'
import { createTestingApp, stopTestingApp, waitForIndexedHeight } from '@src/e2e.module'
import { LoanSchemeMapper } from '@src/module.model/loan.scheme'
import { DeferredLoanSchemeMapper } from '@src/module.model/deferred.loan.scheme'
import BigNumber from 'bignumber.js'

let app: NestFastifyApplication
const testing = Testing.create(new MasterNodeRegTestContainer())

beforeEach(async () => {
  await testing.container.start()
  await testing.container.waitForWalletCoinbaseMaturity()
  await testing.container.waitForWalletBalanceGTE(100)
  app = await createTestingApp(testing.container)
})

afterEach(async () => {
  await stopTestingApp(testing.container, app)
})

async function createLoanScheme (nameAsId: string, minColRatio: number, interestRate: BigNumber): Promise<string> {
  const loanSchemeId = await testing.rpc.loan.createLoanScheme({
    id: nameAsId,
    minColRatio: minColRatio,
    interestRate: interestRate
  })
  await testing.generate(1)
  return loanSchemeId
}

async function updateLoanScheme (nameAsId: string, minColRatio: number, interestRate: BigNumber, activateAfterBlock?: number): Promise<string> {
  const payload: any = {
    id: nameAsId,
    minColRatio: minColRatio,
    interestRate: interestRate
  }
  if (activateAfterBlock !== undefined) {
    payload.activateAfterBlock = activateAfterBlock
  }
  const loanSchemeId = await testing.rpc.loan.updateLoanScheme(payload)
  await testing.generate(1)
  return loanSchemeId
}

it('should deferred model serves pending state', async () => {
  await createLoanScheme('s150', 150, new BigNumber(3))
  await updateLoanScheme('s150', 155, new BigNumber(3.05), 120)

  await createLoanScheme('s160', 160, new BigNumber(4))
  await updateLoanScheme('s160', 165, new BigNumber(4.05), 120)

  await createLoanScheme('s170', 170, new BigNumber(5))
  await updateLoanScheme('s170', 175, new BigNumber(5.05), 120)

  await createLoanScheme('s180', 180, new BigNumber(6))
  await updateLoanScheme('s180', 185, new BigNumber(6.05), 120)

  await createLoanScheme('s190', 190, new BigNumber(7))
  await updateLoanScheme('s190', 195, new BigNumber(7.05), 120)

  await createLoanScheme('s200', 200, new BigNumber(8))
  await updateLoanScheme('s200', 205, new BigNumber(8.05), 120)

  {
    const height = await testing.container.call('getblockcount')
    await testing.container.generate(1)
    await waitForIndexedHeight(app, height)
  }

  const loanSchemeMapper = app.get(LoanSchemeMapper)
  const deferredMapper = app.get(DeferredLoanSchemeMapper)

  // pick s150 check as example
  const s150Before = await loanSchemeMapper.get('s150')
  expect(s150Before).toStrictEqual({
    id: 's150',
    sort: '00000066',
    minColRatio: 150,
    interestRate: '3',
    activateAfterBlock: '0',
    default: true,
    block: expect.any(Object)
  })

  // test pagination
  const first = await deferredMapper.query(120, 2)
  expect(first).toStrictEqual([
    {
      id: 's200-113',
      sort: '00000071',
      loanSchemeId: 's200',
      minColRatio: 205,
      interestRate: '8.05',
      activateAfterBlock: '120',
      default: false,
      block: expect.any(Object)
    },
    {
      id: 's190-111',
      sort: '0000006f',
      loanSchemeId: 's190',
      minColRatio: 195,
      interestRate: '7.05',
      activateAfterBlock: '120',
      default: false,
      block: expect.any(Object)
    }
  ])

  const next = await deferredMapper.query(120, 2, first[first.length - 1].sort)
  expect(next).toStrictEqual([
    {
      id: 's180-109',
      sort: '0000006d',
      loanSchemeId: 's180',
      minColRatio: 185,
      interestRate: '6.05',
      activateAfterBlock: '120',
      default: false,
      block: expect.any(Object)
    },
    {
      id: 's170-107',
      sort: '0000006b',
      loanSchemeId: 's170',
      minColRatio: 175,
      interestRate: '5.05',
      activateAfterBlock: '120',
      default: false,
      block: expect.any(Object)
    }
  ])

  const last = await deferredMapper.query(120, 2, next[next.length - 1].sort)
  expect(last).toStrictEqual([
    {
      id: 's160-105',
      sort: '00000069',
      loanSchemeId: 's160',
      minColRatio: 165,
      interestRate: '4.05',
      activateAfterBlock: '120',
      default: false,
      block: expect.any(Object)
    },
    {
      id: 's150-103',
      sort: '00000067',
      loanSchemeId: 's150',
      minColRatio: 155,
      interestRate: '3.05',
      activateAfterBlock: '120',
      default: true,
      block: expect.any(Object)
    }
  ])

  await testing.container.waitForBlockHeight(120)
  await waitForIndexedHeight(app, 120)

  const s150After = await loanSchemeMapper.get('s150')
  expect(s150After).toStrictEqual({
    id: 's150',
    sort: '00000067',
    minColRatio: 155,
    interestRate: '3.05',
    activateAfterBlock: '120',
    default: true,
    block: expect.any(Object)
  })

  // cleared
  const deferredList = await deferredMapper.query(120, 100)
  expect(deferredList).toStrictEqual([])
})
