import { createTestingApp, DelayedEunosPayaTestContainer, stopTestingApp, waitForIndexedHeight } from '@src/e2e.module'
import { NestFastifyApplication } from '@nestjs/platform-fastify'
import { JsonRpcClient } from '@defichain/jellyfish-api-jsonrpc'
import { MasternodeMapper } from '@src/module.model/masternode'
import { MasternodeInfo } from '@defichain/jellyfish-api-core/dist/category/masternode'
import { MasterNodeRegTestContainer } from '@defichain/testcontainers'

describe('genesis masternodes', () => {
  const container = new MasterNodeRegTestContainer()
  let app: NestFastifyApplication
  let client: JsonRpcClient

  beforeAll(async () => {
    await container.start()
    await container.waitForWalletCoinbaseMaturity()

    app = await createTestingApp(container)
    client = new JsonRpcClient(await container.getCachedRpcUrl())
  })

  afterAll(async () => {
    await stopTestingApp(container, app)
  })

  it('should index genesis masternodes', async () => {
    await container.generate(1)
    const height = await client.blockchain.getBlockCount()
    await container.generate(1)
    await waitForIndexedHeight(app, height)

    const genesisNodeId = 'e86c027861cc0af423313f4152a44a83296a388eb51bf1a6dde9bd75bed55fb4'
    const masternodeRPCInfo: MasternodeInfo =
      (await client.masternode.getMasternode(genesisNodeId))[genesisNodeId]

    const masternodeMapper = app.get(MasternodeMapper)
    const masternodeList = await masternodeMapper.query(30)
    expect(masternodeList.length).toStrictEqual(8)

    const genesisNode = await masternodeMapper.get(genesisNodeId)
    expect(masternodeRPCInfo).not.toStrictEqual(undefined)
    expect(genesisNode?.operatorAddress).toStrictEqual(masternodeRPCInfo.operatorAuthAddress)
    expect(genesisNode?.ownerAddress).toStrictEqual(masternodeRPCInfo.ownerAuthAddress)
    expect(genesisNode?.creationHeight).toStrictEqual(masternodeRPCInfo.creationHeight)
    expect(genesisNode?.resignHeight).toStrictEqual(masternodeRPCInfo.resignHeight)
    expect(genesisNode?.mintedBlocks).toStrictEqual(masternodeRPCInfo.mintedBlocks)
  })
})

describe('create masternode (pre euno paya)', () => {
  const container = new DelayedEunosPayaTestContainer()
  let app: NestFastifyApplication
  let client: JsonRpcClient

  beforeAll(async () => {
    await container.start()
    await container.waitForWalletCoinbaseMaturity()

    app = await createTestingApp(container)
    client = new JsonRpcClient(await container.getCachedRpcUrl())
  })

  afterAll(async () => {
    await stopTestingApp(container, app)
  })

  it('should index create masternode', async () => {
    await container.generate(1)

    const ownerAddress = await client.wallet.getNewAddress()
    const masternodeId = await client.masternode.createMasternode(ownerAddress)
    await container.generate(1)

    const height = await client.blockchain.getBlockCount()
    await container.generate(1)
    await waitForIndexedHeight(app, height)

    const masternodeMapper = app.get(MasternodeMapper)

    const masternodeRPCInfo: MasternodeInfo =
      (await client.masternode.getMasternode(masternodeId))[masternodeId]
    const masternode = await masternodeMapper.get(masternodeId)

    expect(masternode).not.toStrictEqual(undefined)
    expect(masternode?.operatorAddress).toStrictEqual(masternodeRPCInfo.operatorAuthAddress)
    expect(masternode?.ownerAddress).toStrictEqual(masternodeRPCInfo.ownerAuthAddress)
    expect(masternode?.creationHeight).toStrictEqual(masternodeRPCInfo.creationHeight)
    expect(masternode?.resignHeight).toStrictEqual(masternodeRPCInfo.resignHeight)
    expect(masternode?.mintedBlocks).toStrictEqual(masternodeRPCInfo.mintedBlocks)
  })
})