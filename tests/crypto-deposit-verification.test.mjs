import test from "node:test";
import assert from "node:assert/strict";
import {verifyUsdcDeposit,CRYPTO_WALLET,USDC_MINT} from "../src/crypto-deposit-verification.js";
const signature="5".repeat(87);
function response(amount,mint=USDC_MINT,owner=CRYPTO_WALLET,err=null){
  return {ok:true,json:async()=>({result:{blockTime:1790000000,meta:{err,preTokenBalances:[],postTokenBalances:[{owner,mint,uiTokenAmount:{amount:String(amount)}}]}}})};
}
test("USDC verification checks finalized recipient balance, mint and expected amount",async()=>{
  const prev=globalThis.fetch;
  try{
    globalThis.fetch=async()=>response(125000000);
    assert.equal((await verifyUsdcDeposit(signature,125)).ok,true);
    assert.equal((await verifyUsdcDeposit(signature,125.01)).ok,false);
    globalThis.fetch=async()=>response(125000000,"invalid-mint");
    assert.equal((await verifyUsdcDeposit(signature,125)).ok,false);
    globalThis.fetch=async()=>response(125000000,USDC_MINT,"different-wallet");
    assert.equal((await verifyUsdcDeposit(signature,125)).ok,false);
    globalThis.fetch=async()=>response(125000000,USDC_MINT,CRYPTO_WALLET,{InstructionError:[0,"Custom"]});
    assert.equal((await verifyUsdcDeposit(signature,125)).ok,false);
  }finally{globalThis.fetch=prev;}
});
test("USDC verifier rejects missing and malformed signatures",async()=>{
  assert.equal((await verifyUsdcDeposit("not-a-signature",125)).ok,false);
});
