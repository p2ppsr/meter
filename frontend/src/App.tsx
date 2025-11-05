import React, { useState, FormEvent } from 'react'
import { ToastContainer, toast } from 'react-toastify'
import 'react-toastify/dist/ReactToastify.css'
import {
  AppBar,
  Toolbar,
  List,
  ListItem,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  Button,
  Fab,
  LinearProgress,
  Typography,
  IconButton,
  Grid
} from '@mui/material'
import { styled } from '@mui/system'
import AddIcon from '@mui/icons-material/Add'
import GitHubIcon from '@mui/icons-material/GitHub'
import useAsyncEffect from 'use-async-effect'
import { Meter, Token } from './types/types'
import { MeterContract, MeterArtifact } from '@bsv/backend'
import {
  SHIPBroadcaster,
  LookupResolver,
  Transaction,
  Utils,
  ProtoWallet,
  WalletClient,
  SHIPBroadcasterConfig,
  HTTPSOverlayBroadcastFacilitator
} from '@bsv/sdk'
MeterContract.loadArtifact(MeterArtifact)
import { bsv, toByteString } from 'scrypt-ts'
import { Card } from '@mui/material'
import { CardContent } from '@mui/material'
import { CreateActionArgs } from '@bsv/sdk'

// Only used to verify signature
const anyoneWallet = new ProtoWallet('anyone')

// Local wallet
const walletClient = new WalletClient()
const NETWORK_PRESET = 'local' // Change to 'mainnet' for production usage

// These are some basic styling rules for the React application.
// We are using MUI (https://mui.com) for all of our UI components (i.e. buttons and dialogs etc.).
const AppBarPlaceholder = styled('div')({
  height: '4em'
})

const NoItems = styled(Grid)({
  margin: 'auto',
  textAlign: 'center',
  marginTop: '5em'
})

const AddMoreFab = styled(Fab)({
  position: 'fixed',
  right: '1em',
  bottom: '1em',
  zIndex: 10
})

const LoadingBar = styled(LinearProgress)({
  margin: '1em'
})

const GitHubIconStyle = styled(IconButton)({
  color: '#ffffff'
})

const App: React.FC = () => {
  // These are some state variables that control the app's interface.
  const [createOpen, setCreateOpen] = useState<boolean>(false)
  const [createLoading, setCreateLoading] = useState<boolean>(false)
  const [metersLoading, setMetersLoading] = useState<boolean>(true)
  const [meters, setMeters] = useState<Meter[]>([])

  // Creates a new meter.
  // This function will run when the user clicks "OK" in the creation dialog.

  const handleCreateSubmit = async (
    e: FormEvent<HTMLFormElement>
  ): Promise<void> => {
    e.preventDefault()
    try {
      setCreateLoading(true)
      const publicKey = (await walletClient.getPublicKey({ identityKey: true }))
        .publicKey

      const signature = Utils.toHex(
        (
          await walletClient.createSignature({
            data: [1],
            protocolID: [0, 'meter'],
            keyID: '1',
            counterparty: 'anyone'
          })
        ).signature
      )

      const meter = new MeterContract(
        BigInt(1),
        toByteString(publicKey, false),
        toByteString(signature, false)
      )
      const lockingScript = meter.lockingScript.toHex()

      const newMeterToken = await walletClient.createAction({
        description: 'Create a meter',
        outputs: [
          {
            basket: 'meter tokens',
            lockingScript,
            satoshis: 1,
            outputDescription: 'Meter output'
          }
        ],
        options: { randomizeOutputs: false }
      })

      if (!newMeterToken.tx) {
        throw new Error('Transaction is undefined')
      }

      const transaction = Transaction.fromAtomicBEEF(newMeterToken.tx)
      const txid = transaction.id('hex')

      const args: SHIPBroadcasterConfig = {
        networkPreset: NETWORK_PRESET
      }
      const broadcaster = new SHIPBroadcaster(['tm_meter'], args)
      const broadcasterResult = await broadcaster.broadcast(transaction)
      console.log('broadcasterResult:', broadcasterResult)
      if (broadcasterResult.status === 'error') {
        throw new Error('Transaction failed to broadcast')
      }
      toast.dark('Meter successfully created!')
      setMeters(originalMeters => [
        {
          value: 1,
          creatorIdentityKey: publicKey,
          token: {
            atomicBeefTX: Utils.toHex(newMeterToken.tx!),
            txid,
            outputIndex: 0,
            lockingScript: lockingScript,
            satoshis: 1
          } as Token
        },
        ...originalMeters
      ])
      setCreateOpen(false)
    } catch (e) {
      toast.error((e as Error).message)
      console.error(e)
    } finally {
      setCreateLoading(false)
    }
  }

  useAsyncEffect(() => {
    const fetchMeters = async () => {
      try {
        let lookupResult: any = undefined

        try {
          const resolver = new LookupResolver({ networkPreset: NETWORK_PRESET })
          lookupResult = await resolver.query({
            service: 'ls_meter',
            query: { findAll: true }
          })

          // Check the result type
          if (!lookupResult || lookupResult.type !== 'output-list') {
            throw new Error('Wrong result type!')
          }
        } catch (e) {
          console.error('Lookup error:', e)
          return // Return early if lookup fails to prevent further execution
        }

        // Ensure that lookupResult is valid before accessing `outputs`
        if (!lookupResult?.outputs) {
          console.error('No outputs found in lookupResult')
          return // Return early if `outputs` is not available
        }

        const parsedResults: Meter[] = []

        // Process each result
        for (const result of lookupResult.outputs) {
          try {
            const tx = Transaction.fromBEEF(result.beef)
            const script = tx.outputs[
              Number(result.outputIndex)
            ].lockingScript.toHex()
            const meter = MeterContract.fromLockingScript(
              script
            ) as MeterContract

            console.log('meter.count:', meter.count)
            console.log('meter.creatorIdentityKey:', meter.creatorIdentityKey)
            console.log(
              'tx.outputs[Number(result.outputIndex)]:',
              tx.outputs[Number(result.outputIndex)]
            )

            // Signature verification
            const verifyResult = await anyoneWallet.verifySignature({
              protocolID: [0, 'meter'],
              keyID: '1',
              counterparty: meter.creatorIdentityKey,
              data: [1],
              signature: Utils.toArray(meter.creatorSignature, 'hex')
            })

            if (!verifyResult.valid) {
              throw new Error('Signature invalid')
            }

            const atomicBeefTX = Utils.toHex(tx.toAtomicBEEF())

            console.log('fetchMeters Transaction atomicBeefTX:', atomicBeefTX)

            parsedResults.push({
              value: Number(meter.count),
              creatorIdentityKey: String(meter.creatorIdentityKey),
              token: {
                atomicBeefTX,
                txid: tx.id('hex'),
                outputIndex: result.outputIndex,
                lockingScript: script,
                satoshis: tx.outputs[Number(result.outputIndex)]
                  .satoshis as number
              } as Token
            })
          } catch (error) {
            console.error('Failed to parse Meter. Error:', error)
          }
        }

        // Set the meters data
        setMeters(parsedResults)
      } catch (error) {
        console.error('Failed to load Meters:', error)
      } finally {
        setMetersLoading(false)
      }
    }

    fetchMeters()
  }, [])

  const handleIncrement = async (meterIndex: number) => {
    try {
      // Validate meter index
      if (meterIndex < 0 || meterIndex >= meters.length) {
        throw new Error(`Invalid meter index: ${meterIndex}`)
      }

      const meter = meters[meterIndex]

      // Ensure token data is available before proceeding
      if (
        !meter?.token?.atomicBeefTX ||
        !meter.token.lockingScript ||
        !meter.token.txid
      ) {
        throw new Error(
          `Missing required token data for meter index ${meterIndex}`
        )
      }

      // Create Meter Contract instances
      const meterContract = MeterContract.fromLockingScript(
        meter.token.lockingScript
      )
      const nextMeter = MeterContract.fromLockingScript(
        meter.token.lockingScript
      ) as MeterContract
      nextMeter.increment()
      const nextScript = nextMeter.lockingScript

      // Convert from hex string
      const atomicBeef = Utils.toArray(meter.token.atomicBeefTX, 'hex')
      const tx = Transaction.fromAtomicBEEF(atomicBeef)

      // Create a BSV Transaction for sCrypt Smart Contract usage
      const parsedFromTx = new bsv.Transaction(tx.toHex())

      // Generate unlocking script
      const unlockingScript = await meterContract.getUnlockingScript(
        async self => {
          const bsvtx = new bsv.Transaction()
          bsvtx.from({
            txId: meter.token.txid,
            outputIndex: meter.token.outputIndex,
            script: meter.token.lockingScript,
            satoshis: meter.token.satoshis
          })
          bsvtx.addOutput(
            new bsv.Transaction.Output({
              script: nextScript,
              satoshis: meter.token.satoshis
            })
          )
          self.to = { tx: bsvtx, inputIndex: 0 }
          self.from = { tx: parsedFromTx, outputIndex: 0 }
            ; (self as MeterContract).incrementOnChain()
        }
      )

      // Prepare broadcast parameters
      const broadcastActionParams: CreateActionArgs = {
        inputs: [
          {
            inputDescription: 'Increment meter token',
            outpoint: `${meter.token.txid}.${meter.token.outputIndex}`,
            unlockingScript: unlockingScript.toHex()
          }
        ],
        inputBEEF: atomicBeef,
        outputs: [
          {
            basket: 'meter tokens',
            lockingScript: nextScript.toHex(),
            satoshis: meter.token.satoshis,
            outputDescription: 'Counter token'
          }
        ],
        description: `Increment a counter`,
        options: { acceptDelayedBroadcast: false, randomizeOutputs: false }
      }

      // Create Action for Meter Increment
      const newMeterToken = await walletClient.createAction(
        broadcastActionParams
      )

      if (!newMeterToken.tx) {
        throw new Error(
          'Transaction creation failed: newMeterToken.tx is undefined'
        )
      }

      // Convert to Transaction format
      const transaction = Transaction.fromAtomicBEEF(newMeterToken.tx)
      const txid = transaction.id('hex')

      // Configure SHIP Broadcaster with allowHTTP set to true
      const facilitator = new HTTPSOverlayBroadcastFacilitator(fetch, true)
      facilitator.allowHTTP = true // Manually override in case constructor ignores it

      const args: SHIPBroadcasterConfig = {
        networkPreset: NETWORK_PRESET,
        facilitator,
        requireAcknowledgmentFromAnyHostForTopics: 'any'
      }
      const broadcaster = new SHIPBroadcaster(['tm_meter'], args)

      console.log('handleIncrement: broadcaster:', broadcaster)

      // Broadcast the transaction
      const broadcasterResult = await broadcaster.broadcast(transaction)

      console.log('broadcasterResult.txid:', broadcasterResult.txid)
      if (broadcasterResult.status === 'error') {
        console.error(
          'broadcasterResult.description:',
          broadcasterResult.description
        )
        //throw new Error('Transaction failed to broadcast')
      }
      //console.log('broadcasterResult.message:', broadcasterResult.message)

      // Update state with new meter transaction details
      setMeters(originalMeters => {
        const copy = [...originalMeters]
        copy[meterIndex] = {
          ...copy[meterIndex],
          value: copy[meterIndex].value + 1,
          token: {
            atomicBeefTX: Utils.toHex(newMeterToken.tx!),
            txid,
            outputIndex: 0,
            lockingScript: nextScript.toHex(),
            satoshis: meter.token.satoshis
          } as Token
        }
        return copy
      })
    } catch (error) {
      console.error('Error in meter increment:', (error as Error).message)
      throw new Error(`Meter increment failed: ${(error as Error).message}`)
    }
  }

  const handleDecrement = async (meterIndex: number) => {
    try {
      // Validate meter index
      if (meterIndex < 0 || meterIndex >= meters.length) {
        throw new Error(`Invalid meter index: ${meterIndex}`)
      }

      const meter = meters[meterIndex]

      // Ensure token data is available before proceeding
      if (
        !meter?.token?.atomicBeefTX ||
        !meter.token.lockingScript ||
        !meter.token.txid
      ) {
        throw new Error(
          `Missing required token data for meter index ${meterIndex}`
        )
      }

      // Create Meter Contract instances
      const meterContract = MeterContract.fromLockingScript(
        meter.token.lockingScript
      )
      const nextMeter = MeterContract.fromLockingScript(
        meter.token.lockingScript
      ) as MeterContract
      nextMeter.decrement()
      const nextScript = nextMeter.lockingScript

      // Convert from hex string
      const atomicBeef = Utils.toArray(meter.token.atomicBeefTX, 'hex')
      const tx = Transaction.fromAtomicBEEF(atomicBeef)

      // Create a BSV Transaction for sCrypt Smart Contract usage
      const parsedFromTx = new bsv.Transaction(tx.toHex())

      // Generate unlocking script
      const unlockingScript = await meterContract.getUnlockingScript(
        async self => {
          const bsvtx = new bsv.Transaction()
          bsvtx.from({
            txId: meter.token.txid,
            outputIndex: meter.token.outputIndex,
            script: meter.token.lockingScript,
            satoshis: meter.token.satoshis
          })
          bsvtx.addOutput(
            new bsv.Transaction.Output({
              script: nextScript,
              satoshis: meter.token.satoshis
            })
          )
          self.to = { tx: bsvtx, inputIndex: 0 }
          self.from = { tx: parsedFromTx, outputIndex: 0 }
            ; (self as MeterContract).decrementOnChain()
        }
      )

      // Prepare broadcast parameters
      const broadcastActionParams: CreateActionArgs = {
        inputs: [
          {
            inputDescription: 'Decrement meter token',
            outpoint: `${meter.token.txid}.${meter.token.outputIndex}`,
            unlockingScript: unlockingScript.toHex()
          }
        ],
        inputBEEF: atomicBeef,
        outputs: [
          {
            basket: 'meter tokens',
            lockingScript: nextScript.toHex(),
            satoshis: meter.token.satoshis,
            outputDescription: 'Counter token'
          }
        ],
        description: `Decrement a counter`,
        options: { acceptDelayedBroadcast: false, randomizeOutputs: false }
      }

      // Create Action for Meter Decrement
      const newMeterToken = await walletClient.createAction(
        broadcastActionParams
      )

      if (!newMeterToken.tx) {
        throw new Error(
          'Transaction creation failed: newMeterToken.tx is undefined'
        )
      }

      // Convert to Transaction format
      const transaction = Transaction.fromAtomicBEEF(newMeterToken.tx)
      const txid = transaction.id('hex')

      // Configure SHIP Broadcaster with allowHTTP set to true
      const facilitator = new HTTPSOverlayBroadcastFacilitator(fetch, true)
      facilitator.allowHTTP = true // Manually override in case constructor ignores it

      const args: SHIPBroadcasterConfig = {
        networkPreset: NETWORK_PRESET,
        facilitator,
        requireAcknowledgmentFromAnyHostForTopics: 'any'
      }
      const broadcaster = new SHIPBroadcaster(['tm_meter'], args)

      console.log('handleDecrement: broadcaster:', broadcaster)

      // Broadcast the transaction
      const broadcasterResult = await broadcaster.broadcast(transaction)

      console.log('broadcasterResult.txid:', broadcasterResult.txid)
      if (broadcasterResult.status === 'error') {
        console.error(
          'broadcasterResult.description:',
          broadcasterResult.description
        )
        //throw new Error('Transaction failed to broadcast')
      }
      //console.log('broadcasterResult.message:', broadcasterResult.message)

      // Update state with new meter transaction details
      setMeters(originalMeters => {
        const copy = [...originalMeters]
        copy[meterIndex] = {
          ...copy[meterIndex],
          value: copy[meterIndex].value - 1,
          token: {
            atomicBeefTX: Utils.toHex(newMeterToken.tx!),
            txid,
            outputIndex: 0,
            lockingScript: nextScript.toHex(),
            satoshis: meter.token.satoshis
          } as Token
        }
        return copy
      })
    } catch (error) {
      console.error('Error in meter decrement:', (error as Error).message)
      throw new Error(`Meter decrement failed: ${(error as Error).message}`)
    }
  }

  return (
    <>
      <ToastContainer
        position="top-right"
        autoClose={5000}
        hideProgressBar={false}
        newestOnTop={false}
        closeOnClick
        rtl={false}
        pauseOnFocusLoss
        draggable
        pauseOnHover
      />
      <AppBar position="static">
        <Toolbar>
          <Typography variant="h6" component="div" sx={{ flexGrow: 1 }}>
            Meter — Counters, Up and Down.
          </Typography>
          <GitHubIconStyle
            onClick={() =>
              window.open('https://github.com/p2ppsr/meter', '_blank')
            }
          >
            <GitHubIcon />
          </GitHubIconStyle>
        </Toolbar>
      </AppBar>
      <AppBarPlaceholder />

      {meters.length >= 1 && (
        <AddMoreFab
          color="primary"
          onClick={() => {
            setCreateOpen(true)
          }}
        >
          <AddIcon />
        </AddMoreFab>
      )}

      {metersLoading ? (
        <LoadingBar />
      ) : (
        <List>
          {meters.length === 0 && (
            <NoItems
              container
              direction="column"
              justifyContent="center"
              alignItems="center"
            >
              <Grid item align="center">
                <Typography variant="h4">No Meters</Typography>
                <Typography color="textSecondary">
                  Use the button below to start a meter
                </Typography>
              </Grid>
              <Grid
                item
                align="center"
                sx={{ paddingTop: '2.5em', marginBottom: '1em' }}
              >
                <Fab
                  color="primary"
                  onClick={() => {
                    setCreateOpen(true)
                  }}
                >
                  <AddIcon />
                </Fab>
              </Grid>
            </NoItems>
          )}
          <List>
            {meters.map((meter, i) => (
              <ListItem key={i}>
                <Card sx={{ width: '100%', textAlign: 'center', padding: 2 }}>
                  <CardContent>
                    <Typography variant="h6">
                      Meter Value: {meter.value}
                    </Typography>
                    <Button
                      variant="contained"
                      color="primary"
                      onClick={() => handleIncrement(i)}
                    >
                      +
                    </Button>
                    <Button
                      variant="contained"
                      color="secondary"
                      onClick={() => handleDecrement(i)}
                    >
                      -
                    </Button>
                    <Typography variant="subtitle2" sx={{ marginTop: 1 }}>
                      Identity Key:
                    </Typography>
                    <Typography variant="body2">
                      {meter.creatorIdentityKey}
                    </Typography>
                  </CardContent>
                </Card>
              </ListItem>
            ))}
          </List>
        </List>
      )}

      <Dialog
        open={createOpen}
        onClose={() => {
          setCreateOpen(false)
        }}
      >
        <form
          onSubmit={e => {
            e.preventDefault()
            void (async () => {
              try {
                await handleCreateSubmit(e)
              } catch (error) {
                console.error('Error in form submission:', error)
              }
            })()
          }}
        >
          <DialogTitle>Create a Meter</DialogTitle>
          <DialogContent>
            <DialogContentText paragraph>
              Meters can be incremented and decremented after creation.
            </DialogContentText>
          </DialogContent>
          {createLoading ? (
            <LoadingBar />
          ) : (
            <DialogActions>
              <Button
                onClick={() => {
                  setCreateOpen(false)
                }}
              >
                Cancel
              </Button>
              <Button type="submit">OK</Button>
            </DialogActions>
          )}
        </form>
      </Dialog>
    </>
  )
}

export default App
