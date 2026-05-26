/**
 * Guard / end-to-end correctness test:
 *
 *   1. Parse the cited 2022 inflation-claim TX hex (block 1,081,893).
 *   2. Decode the cited 2022 deroproof string → blinder point + V (uint64).
 *   3. For each of the 16 ring slots, recompute x = V × G + blinder and check
 *      against C[slot] — mirrors `proof.Prove()` at `proof/proof.go:88-95`.
 *   4. Confirm exactly one slot matches and that it is the slot the public
 *      rebuttal page names as the receiver.
 *
 * If this passes, the TS bn254 wrapper + proof decoder + TX parser collectively
 * reproduce DERO's proof-verification path. That is the prerequisite for
 * forging strings that an unpatched explorer will accept.
 *
 * The TX hex is bundled inline (~5KB) so this script works offline. To
 * regenerate it: call `dero_get_transaction` for tx
 * `5bbe1b7eecfe3447cb045b1197a07a214b456968eda8a3d5a90f5fae9ce57e55` and copy
 * `txs_as_hex[0]`.
 */

import { add, G, scalarMult, uint64ToSignedScalar, deroDecompressHex, pointsEqual } from '../src/bn254.js'
import { decodeDeroBech32, CITED_2022_PROOF_STRING } from '../src/proof-decode.js'
import { parseTransaction } from '../src/tx-parse.js'

const CITED_2022_TX_HEX =
  '01000003a184427366129e135d0d87463c0bb78bf1e0cf9b86b2a34ecd5a14c101def5cc6e12110100000000000000000000000000000000000000000000000000000000000000000000b2dd629bad96b0e68ac4fc5d8494ac33e9fb756aa210ef309830ccd53d12c1d8aae9800189da5d31c5b772f1d598d44e60cc53bc280ab0165366e949b55e46fe93e8fd66668ba1a15a5408f299ac33493696334dc2277143ec788906b05b038dd2533f87f8f219d31f8b801c89b4e5911d5ca6714d686a32e1f15e4eca62542b62fc2147c52f49082563fdadb6062f61510405b5010f36635d3db82cefe53bdee336ba3418414561182b43cd02d5d209d7642e3f14013d4ff70a4de13e32db121df9c5e16dccc6492b251344e7bc6dce40f54c97a4b093442968d2f556ba286aacd82c5914ca557a6c1326b542415e3120d8b02c05bb3414489068da33a139da07223d6561b424bc56cc1de1ef89ad78e21d214bc017a2479f0411ab6396a3fb237f04e8a661012061bc9e852ef10027d1bc5cd415706799b5672378c968634f4a1486b3ffc5c30100094888307f18aa73da72dfc9c3552a9008a288bb25927c8030a3aaba2cdb6f000cd39fa8f0fe60707e28c883477e17f9a365705376c0469bd0547f6ac8caaa7b0115942441b053c7d9ac54178a4875bafeeb1a88013889596b5ccb57b31885661d011f5a2750ac17bcdaa368848058d5309d9a39961a6807e7e03d031a0dcabdfd6100042c0c72ab24cbd6097650fe08f51eeec703c0fb4ffb04f0971cdaa351bfc526000efedaf40177c2761e58c2594157af5cc347bc1435199c6a6f17d7b3f87386180004f84a6fcbc5c9bbd2eeca441ea389714740b50d0e7991dcb594aa4228a5a08f0008c2ea7a3a096e3ea852b0104156a73fe92e6f06984f4a48e50efc8c5abed5690015dcd2541a08dc6c702ae87a3dd9a0493d5933ac99281b76c79c7f92c9e137c9001d0eadee405a4a734e68561e59ce0425791a82061d4e486818198fe63883e80f010029984751cfcebc765d83ae31839414902e50b076511d2291e0f3fc0ff88d1500122b56d71137fd3a2cc4e9a1bf0bd07e3579b578807a9ef1bdd713940c6b102501086177b79da9019b0f1c9bfbaef692e3965ca4286ebba65899bf9629c397f36a0011dc89e4e302a43b966f3b8baff82c0a7877d5853c771fbd77c202180113b05400cc7cf9ebf268d719c55e2763f14e0d3e4e44712a1dcfd3ede5390b8bc5efd7c82754d7de4ad6404f8809062d4930926ee92daaeaa5a3db2e955077bfc1a0359e00298e09ccc8b91a51b4159c493ffff4e26508bc5393465ead34dd1e82b782ba3b0105e0465c0726dcda530a25358adb78544d713c419a4042370dd944fa931509bd012f2dbdfa461c362e33fba87301cddb08399ab973db5b974987ed511ec30c45e301179edab98c609ce9ded80d76b582c0c00e8f617642b1d5299d5b976ebffcf8200028c28ba0ee6356c6d462d03e9d9256e5941603cdbf76dd33b9763538667a804f0012b5944c9063b54c8d1bba91f1ef68130f7b889ffae59cc681883960f90f730f000f46f7a42256451709481b5a77b35c7011a964ddc59e23db11c376bd34e19ae901086c99b2340456b5c45c44d184fc0010eaa60a854903e4c40ec7a84de54a04a00103d2a898a180cc1ca2af120bb589a96e6c7140190df92d566ab7a55e63c753e50117914991573d63812bee5bf945a4a8b50a0e441d15abfe18573f9c906da6a74100262d44e5c5a05781d44934bd3e309cdd74fe76f00e558060e09b073ef29221910019de6558bdd3e29bc10801fbdb2bc48d4130bc027928bc6a9c324f6630f968370029f2a5ec1b35a540638c03a47e064a2f43515989f8fbc1960b4627e28f81333a0019ca4a63413de39bedafc84b2ab1ed4b73ab34a1d9d5981f1ff5cd6b8e8ff397000a475e335a5d5c7261216a0afa22bce66a5dd71310c39d1aab731ff04dec70c10006fc9cfbf624ecaee3498bae908465472f657a9bc6882be359de679b8aca66930023225593c3af1f3d088f5b77d22da426a8dcccf79dd1b9b2cb6116101befcd15000790fa3b9365ee557ddbccc8588ede01ed2bc3afd44784a4aa43dcd0176d16890121d66d312d72943b0d28bdd26b22cce242a84e519370b31ffa1e4973f3575b32002d193412f64d43cf0f0e47f45d3fa4cc7c9de05f2722b04181827ef7782f667c0009e50c6c12a3bea40a0603f545886cda808aebc45621526e7662f080afbaa5f40112656e164da57ccdee3c333c2be20d7fa5322c31d5664306999db4fdb69c9d80012ee8a6044bd7792be0bc7dc0b22e9ada9a60688c7545ca8e147cd70d776ee18101121427d98166c3d0b2ad738d37b09fdb43d4c13d01c7b5057d8df6b12c81ba65000358fe95033f7e309ff5413c26d999285c509cbad1aa0e890d836ea4426892c501075ed3f927ffa81046753a85470cd8c38963e2850aae86ed9391e83e483e597c00063db2eb94e4f1278d36b3c451f5756f27c7a6120ef08e5d790ab2075bdbf8ac0005b1a0e9d5df27bbd027884a382fb9fca8560f5673c4bd839b7d95668e2fe1ba00083cd6396d388e0846b388d0869f4bf7053b20f54c438447149a3aec15fce064001f40a1befbb68043b283b0dea3398b3c825ab3151d52bb44c24e3d74160e660d01227ffac40bc514ff61965ca35df6480db4080e409abc979379aa4681bebe57b6011cc69e4e9d28e3972bc1f82b04c9546350a397b628bdfe038785d0a564e5ed24003048feb2c181643794d99703bcc8a6ebf4ee40006d7c6a8a191c04ceea893b0e011c0e2b9fcf4ebbfbd2502ea5c6067193e493824a1f8a24d72fd0d883f0ecf507000de2cf50b9932b033078827d2e8d570ac8f37a0875a327462a39e06d5040f75d01169c0a269b4bcf77f81f4d0d980f33f3a21d4e381b775e5104d2883369842e4b010c64a0ef8f7678ea386eea0d8263433203dd1167b85d6c7cfa8c29ee383a42990346b0fd31c889d46c5778feb4f25f8076e9c20d07f3e6487c5d9aa5bb07657913947190b64cc6ce9c7b64a357eaf6ed54fcb7c0a058a3d28cae8fc280b7862a09859882dccf0eb149bcbdde31b7d832af332a6d9a109d1f82696c4043d03b45000000000000000000000000000000000000000000000000000000000000000001a4ff5bfafdb077850d6882070e51458919d5eee7b340606f45464dd2a244e5125d1ca0e3f916b0a9465f0faff7bd166445492f71ebb8ddd0352e2ef66626df20b711f1edde4526eb7a89ec8d1f5577c3c9ebd31ea0d2bd50b36fb53004e09427300225ccc21fc8eb4fe9fb2a1e63c47a3815fcbb4801fbc2713d03239374c914ae796b940776fe69ca5dca659d7ff7d1ca675bb9ba0094c233ae888332ae9601171d8c5bac828c2d30943581270061df9ec1e0aad59b9f8399084c6399d5d519012ec24d298bd0db59ad5b5642a16d9478f7f72ca58d76036341dfa4f08fc4cba80976c4bce2c2fad0627cfd0d6f53ebd281113c0e80cca80f6547270980b008f5005114761b5c4fa8bbd9c5324caa51d319ff5724d9bd5927791b38f91037a70d2e308014203694d640ab77132e3ba467b95443c4ac186393a779adb5af4fb1211635597546df01ccd23d865a56e8b34b231a9f4c6e9d14a9fa92463d847138fe0b7ca5f892037e248bc4999dac4e13a23c8935b51c2efbe433d8e9706dcd2f8f0d0ce5aeeb2c9355dbfb2ef420e096e8590996b6d7d8baadc065ce76210a14900c73e2aeac5c1b1b4f2de618e640c64884375e1f3f9ad13bbf80c00158c672c52806efc557a5de3ceb3b5169468963654d0c81318a0a2a3fa53415d315249674029199415f8c9ffc0ad2fef44b26a79e1749bee67f76cc2bb4c8fe204baff3cd00184bdeb1a5f8ff19aa338bf01533deea504122615319a4c78f8084b186848e41000f796c3124f94392e91ee64af53700ee9481ff30c325a0c49c202e7d5b55d567011b7313246dbb46917ce298b632e04e1c8c05771ca7ed5aaf07abeaddfe9f0852002838be800d94911166267f406ca6c119181a52062fadad01bc538228e216f701012c011ed9a19a2dc1c3a1538f92ad6870903cd0a2d9f2158f87db92f36b08e3bc01083a82df3971ebfb3dda36f651e06aa81ce0a96a8b20fb534f8c1250ebfc438f0019dd6d364402116a3894affe883d1d32334701669f426ca09d9f209f3d69dd950108050c4b5adbd1eaecfc102fc6b1517bb21e02826ac69192080dcdfa126953c7010d35a0e0c050f3d4c8c7f4accea1f25e7e320d33a59dff23636fa0187f1a00670122f6043f0355d3d392704644d47864e8a40d48eb81d5816aff5166db6a9bc794000449c0dd4cd54e2303ebc4127318122a07285aa172480724eee2982ee1fe434a0006812500261530cf902884639abb94816204c7f435cb91d0dc966a158ed57ee9000153ee9e9853f792cebf2d688b2e3b4f5c7e30f860ae9e704da332edcb33f55b01'

const EXPECTED_RECEIVER_SLOT = 14

try {
  // 1. Parse TX.
  const tx = parseTransaction(CITED_2022_TX_HEX)
  if (tx.payloads.length !== 1) {
    throw new Error(`expected 1 payload, got ${tx.payloads.length}`)
  }
  const stmt = tx.payloads[0].statement
  if (stmt.ring_size !== 16) {
    throw new Error(`expected ring size 16, got ${stmt.ring_size}`)
  }

  // 2. Decode cited 2022 proof string.
  const decoded = decodeDeroBech32(CITED_2022_PROOF_STRING)
  if (decoded.value_transfer_uint64 === undefined) {
    throw new Error('cited proof: missing V')
  }
  const blinder = deroDecompressHex(decoded.public_key_hex)

  // 3. proof.Prove() inner loop: x = V × G + blinder; find matching C[k].
  const x = add(scalarMult(G, uint64ToSignedScalar(decoded.value_transfer_uint64)), blinder)
  let matchedSlot = -1
  for (let k = 0; k < stmt.ring_size; k++) {
    if (pointsEqual(x, stmt.C[k])) {
      if (matchedSlot !== -1) {
        throw new Error(`multiple slots matched: ${matchedSlot} and ${k}`)
      }
      matchedSlot = k
    }
  }

  if (matchedSlot === -1) {
    throw new Error('no ring slot satisfied amount × G + blinder == C[k]')
  }
  if (matchedSlot !== EXPECTED_RECEIVER_SLOT) {
    throw new Error(
      `slot mismatch — proof.Prove() resolves to slot ${matchedSlot}, ` +
        `but docs/handoff name slot ${EXPECTED_RECEIVER_SLOT}`,
    )
  }

  console.log(
    `check:tx-parse OK — cited 2022 proof resolves to ring slot ${matchedSlot} via TS proof.Prove() path`,
  )
  console.log(`  TX type: ${tx.type} (NORMAL=3), height: ${tx.height}, payloads: ${tx.payloads.length}`)
  console.log(`  Statement: ring_size=${stmt.ring_size}, fees=${stmt.fees}, bytes_per_pk=${stmt.bytes_per_publickey}`)
  console.log(`  D (sender ephemeral) = ${stmt.D_hex}`)
  console.log(`  V (decoded uint64)   = ${decoded.value_transfer_uint64}`)
  console.log(`  matched C[${matchedSlot}] = ${stmt.C_hex[matchedSlot]}`)
} catch (err) {
  console.error('check:tx-parse FAILED')
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
}
