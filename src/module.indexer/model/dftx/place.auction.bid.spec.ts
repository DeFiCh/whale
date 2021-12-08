import { NestFastifyApplication } from '@nestjs/platform-fastify'
import { TestingGroup, Testing } from '@defichain/jellyfish-testing'
import { MasterNodeRegTestContainer } from '@defichain/testcontainers'
import { createTestingApp, stopTestingApp, waitForIndexedHeight } from '@src/e2e.module'
import { VaultAuctionHistoryMapper } from '@src/module.model/vault.auction.history'
import BigNumber from 'bignumber.js'
import { RegTestFoundationKeys } from '@defichain/jellyfish-network'

let app: NestFastifyApplication
const tGroup = TestingGroup.create(2, i => new MasterNodeRegTestContainer(RegTestFoundationKeys[i]))
const alice = tGroup.get(0)
const bob = tGroup.get(1)
let colAddr: string
let bobColAddr: string
let vaultId: string

beforeEach(async () => {
  await tGroup.start()
  await alice.container.waitForWalletCoinbaseMaturity()
  app = await createTestingApp(alice.container)

  colAddr = await alice.generateAddress()
  bobColAddr = await bob.generateAddress()

  await dfi(alice, colAddr, 300000)
  await createToken(alice, 'BTC', colAddr)
  await mintTokens(alice, 'BTC', 50)
  await alice.rpc.account.sendTokensToAddress({}, { [colAddr]: ['25@BTC'] })
  await alice.container.call('createloanscheme', [100, 1, 'default'])
  await alice.generate(1)

  const priceFeeds = [
    { token: 'DFI', currency: 'USD' },
    { token: 'BTC', currency: 'USD' },
    { token: 'AAPL', currency: 'USD' },
    { token: 'TSLA', currency: 'USD' },
    { token: 'MSFT', currency: 'USD' }
  ]
  const oracleId = await alice.rpc.oracle.appointOracle(await alice.generateAddress(), priceFeeds, { weightage: 1 })
  await alice.generate(1)
  await alice.rpc.oracle.setOracleData(oracleId, now(), {
    prices: [
      { tokenAmount: '1@DFI', currency: 'USD' },
      { tokenAmount: '10000@BTC', currency: 'USD' },
      { tokenAmount: '2@AAPL', currency: 'USD' },
      { tokenAmount: '2@TSLA', currency: 'USD' },
      { tokenAmount: '2@MSFT', currency: 'USD' }
    ]
  })
  await alice.generate(1)

  await setCollateralToken(alice, 'DFI')
  await setCollateralToken(alice, 'BTC')

  await setLoanToken(alice, 'AAPL')
  await setLoanToken(alice, 'TSLA')
  await setLoanToken(alice, 'MSFT')

  const mVaultId = await createVault(alice, 'default')
  await depositToVault(alice, mVaultId, colAddr, '200000@DFI')
  await depositToVault(alice, mVaultId, colAddr, '20@BTC')
  await takeLoan(alice, mVaultId, ['60000@TSLA', '60000@AAPL', '60000@MSFT'])

  await alice.rpc.account.sendTokensToAddress({}, { [colAddr]: ['30000@TSLA', '30000@AAPL', '30000@MSFT'] })
  await alice.rpc.account.sendTokensToAddress({}, { [bobColAddr]: ['30000@TSLA', '30000@AAPL', '30000@MSFT'] })
  await alice.generate(1)
  await tGroup.waitForSync()

  vaultId = await createVault(alice, 'default')
  await depositToVault(alice, vaultId, colAddr, '10000@DFI')
  await depositToVault(alice, vaultId, colAddr, '1@BTC')
  await takeLoan(alice, vaultId, '7500@AAPL')
  await takeLoan(alice, vaultId, '2500@TSLA')

  {
    // When there is no liquidation occurs
    const data = await alice.container.call('listauctions', [])
    expect(data).toStrictEqual([])

    const list = await alice.container.call('listauctions')
    expect(list.every((each: any) => each.state === 'active'))
  }

  // liquidated
  await alice.rpc.oracle.setOracleData(oracleId, now(), {
    prices: [
      { tokenAmount: '2.2@AAPL', currency: 'USD' },
      { tokenAmount: '2.2@TSLA', currency: 'USD' },
      { tokenAmount: '2.2@MSFT', currency: 'USD' }
    ]
  })
  await alice.container.generate(13)

  {
    const list = await alice.container.call('listauctions')
    expect(list.every((each: any) => each.state === 'inLiquidation'))
  }

  // BID WAR!!
  // vaultId[0]
  await placeAuctionBid(alice, vaultId, 0, colAddr, '5300@AAPL')
  await tGroup.waitForSync()
  await placeAuctionBid(bob, vaultId, 0, bobColAddr, '5355@AAPL')
  await tGroup.waitForSync()
  await placeAuctionBid(alice, vaultId, 0, colAddr, '5408.55@AAPL')
  await tGroup.waitForSync()

  // vaultId[1]
  await placeAuctionBid(alice, vaultId, 1, colAddr, '2700.00012@AAPL')
  await tGroup.waitForSync()
  await placeAuctionBid(bob, vaultId, 1, bobColAddr, '2730@AAPL')
  await tGroup.waitForSync()
  await placeAuctionBid(alice, vaultId, 1, colAddr, '2760.0666069@AAPL')
  await tGroup.waitForSync()

  // vaultId[2]
  await placeAuctionBid(alice, vaultId, 2, colAddr, '2625.00499422@TSLA')
  await tGroup.waitForSync()
})

afterEach(async () => {
  await stopTestingApp(tGroup, app)
})

it('should index placeAuctionBid', async () => {
  {
    const height = await alice.container.call('getblockcount')
    await alice.container.generate(1)
    await waitForIndexedHeight(app, height - 1)
  }

  const mapper = app.get(VaultAuctionHistoryMapper)
  { // vaultId[0]
    const history = await mapper.query(`${vaultId}-0`, 100)
    expect(history).toStrictEqual([
      {
        id: expect.any(String),
        key: `${vaultId}-0`,
        sort: '0000008a',
        vaultId: vaultId,
        index: 0,
        from: expect.any(String),
        amount: { token: '5408.55', currency: 'AAPL' },
        block: expect.any(Object)
      },
      {
        id: expect.any(String),
        key: `${vaultId}-0`,
        sort: '00000089',
        vaultId: vaultId,
        index: 0,
        from: expect.any(String),
        amount: { token: '5355', currency: 'AAPL' },
        block: expect.any(Object)
      },
      {
        id: expect.any(String),
        key: `${vaultId}-0`,
        sort: '00000088',
        vaultId: vaultId,
        index: 0,
        from: expect.any(String),
        amount: { token: '5300', currency: 'AAPL' },
        block: expect.any(Object)
      }
    ])

    { // vaultId[1]
      const history = await mapper.query(`${vaultId}-1`, 100)
      expect(history).toStrictEqual([
        {
          id: expect.any(String),
          key: `${vaultId}-1`,
          sort: '0000008d',
          vaultId: vaultId,
          index: 1,
          from: expect.any(String),
          amount: { token: '2760.0666069', currency: 'AAPL' },
          block: expect.any(Object)
        },
        {
          id: expect.any(String),
          key: `${vaultId}-1`,
          sort: '0000008c',
          vaultId: vaultId,
          index: 1,
          from: expect.any(String),
          amount: { token: '2730', currency: 'AAPL' },
          block: expect.any(Object)
        },
        {
          id: expect.any(String),
          key: `${vaultId}-1`,
          sort: '0000008b',
          vaultId: vaultId,
          index: 1,
          from: expect.any(String),
          amount: { token: '2700.00012', currency: 'AAPL' },
          block: expect.any(Object)
        }
      ])
    }

    { // vaultId[2]
      const history = await mapper.query(`${vaultId}-2`, 100)
      expect(history).toStrictEqual([
        {
          id: expect.any(String),
          key: `${vaultId}-2`,
          sort: '0000008e',
          vaultId: vaultId,
          index: 2,
          from: expect.any(String),
          amount: { token: '2625.00499422', currency: 'TSLA' },
          block: expect.any(Object)
        }
      ])
    }
  }
})

function now (): number {
  return Math.floor(new Date().getTime() / 1000)
}
async function dfi (testing: Testing, address: string, amount: number): Promise<void> {
  await testing.token.dfi({
    address: address,
    amount: amount
  })
  await testing.generate(1)
}
async function createToken (testing: Testing, symbol: string, address: string): Promise<void> {
  await testing.token.create({
    symbol: symbol,
    collateralAddress: address
  })
  await testing.generate(1)
}
async function mintTokens (testing: Testing, symbol: string, amount: number): Promise<void> {
  await testing.token.mint({
    symbol: symbol,
    amount: amount
  })
  await testing.generate(1)
}
async function setCollateralToken (testing: Testing, symbol: string): Promise<void> {
  await testing.rpc.loan.setCollateralToken({
    token: symbol,
    factor: new BigNumber(1),
    fixedIntervalPriceId: `${symbol}/USD`
  })
  await testing.generate(1)
}
async function setLoanToken (testing: Testing, symbol: string): Promise<void> {
  await testing.rpc.loan.setLoanToken({
    symbol: symbol,
    fixedIntervalPriceId: `${symbol}/USD`
  })
  await testing.generate(1)
}
async function createVault (testing: Testing, schemeId: string, address?: string): Promise<string> {
  const vaultId = await testing.container.call(
    'createvault', [address ?? await testing.generateAddress(), schemeId]
  )
  await testing.generate(1)
  return vaultId
}
async function depositToVault (testing: Testing, vaultId: string, address: string, tokenAmt: string): Promise<void> {
  await testing.container.call('deposittovault', [vaultId, address, tokenAmt])
  await testing.generate(1)
}
async function takeLoan (testing: Testing, vaultId: string, amounts: string | string[]): Promise<void> {
  await testing.rpc.loan.takeLoan({ vaultId, amounts })
  await testing.generate(1)
}
async function placeAuctionBid (testing: Testing, vaultId: string, index: number, addr: string, tokenAmt: string): Promise<void> {
  await testing.container.call('placeauctionbid', [vaultId, index, addr, tokenAmt])
  await testing.generate(1)
}