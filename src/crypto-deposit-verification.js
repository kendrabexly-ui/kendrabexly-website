// Finalized mainnet USDC payment verification. Never trust a client-submitted hash alone.
export const CRYPTO_WALLET="FKk2QHEXEJgk912qipmcD7zi3Xrg6yN43byTa1CtFSfB";
export const USDC_MINT="EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export async function verifyUsdcDeposit(signature, amountUsd, rpcUrl="https://api.mainnet-beta.solana.com") {
  if(!/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(String(signature||""))) return {ok:false,reason:"Invalid transaction signature."};
  if(!Number.isFinite(amountUsd)||amountUsd<=0)return {ok:false,reason:"Invalid expected deposit amount."};
  const response=await fetch(rpcUrl,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({
    jsonrpc:"2.0",id:1,method:"getTransaction",params:[signature,{encoding:"jsonParsed",commitment:"finalized",maxSupportedTransactionVersion:0}]
  })});
  if(!response.ok)throw new Error("Solana RPC unavailable");
  const json=await response.json();
  const tx=json.result;
  if(!tx||tx.meta?.err!==null || !tx.blockTime)return {ok:false,reason:"Transaction not finalized or failed."};
  // Only credit the increase in the recipient's token balance for native Solana USDC.
  const balances=arr=>(arr||[]).filter(b=>b.owner===CRYPTO_WALLET&&b.mint===USDC_MINT)
    .reduce((sum,b)=>sum+BigInt(b.uiTokenAmount?.amount||"0"),0n);
  const received=balances(tx.meta.postTokenBalances)-balances(tx.meta.preTokenBalances);
  const expected=BigInt(Math.round(amountUsd*1_000_000));
  if(received<expected)return {ok:false,reason:"Recipient received less USDC than the required deposit."};
  return {ok:true,signature,receivedUsdc:Number(received)/1_000_000,blockTime:tx.blockTime};
}
