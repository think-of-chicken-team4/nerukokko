/** デバイスシミュレーターを使えるか。公開する環境では NEXT_PUBLIC_ENABLE_SIMULATOR=false にして隠す */
export function isSimulatorEnabled(): boolean {
  return process.env.NEXT_PUBLIC_ENABLE_SIMULATOR !== "false";
}
