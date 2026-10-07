/** Only the Wabisator fields the Observatory reads. Nullable ones are null in real data. */
export interface FlowCoordinator { Key: string; Name: string; Status: string; Volume: number; Coinjoins: number; FreshBtc: number; RemixInBtc: number; RemixOutBtc: number; InternalRemixBtc: number }
export interface FlowCoinjoin { TxId: string; Coordinator: string; Time: number; Volume: number; Inputs: number; Outputs: number; FreshBtc: number; Anonset: number; FeeRate: number; Remixes: { From: string; Btc: number; Coins: number }[]; Analyzed: boolean }
export interface FlowLink { From: string; To: string; Btc: number; Coins: number }
export interface FlowMap { Since: string; Until: string; UpdatedAt: string; Coordinators: FlowCoordinator[]; Coinjoins: FlowCoinjoin[]; Links: FlowLink[]; Totals: { Volume: number; Coinjoins: number; FreshBtc: number; CrossRemixBtc: number; InternalRemixBtc: number } }
export interface RoundState { RoundId: string; IsBlameRound: boolean; InputCount: number; MaxSuggestedAmount: number; InputRegistrationRemaining: string; Phase: string }
export interface StatusCoordinator { Key: string; Name: string; Status: string; Fees: string; CoordinationFeeRate: number | null; ReadMore: string; Config: Record<string, string | number> | null; RoundStates: RoundState[]; AbsoluteMinInputCount: number | null; Volume24h: number; Coinjoins24h: number; LastSeen: string | null; OfflineSince: string | null }
export interface CoordinatorsStatus { UpdatedAt: string; Coordinators: StatusCoordinator[] }
export interface VolumeHistory { UpdatedAt: string; Coordinators: Record<string, { Name: string; Daily: { Date: string; Volume: number; Coinjoins: number }[]; TotalVolume: number; TotalCoinjoins: number; Ath: { Date: string; Volume: number } }> }
export interface RoundRow { RoundId: string; IsBlame: boolean; RoundEndTime: string; TxId: string; InputCount: number; OutputCount: number; TotalInputAmount: number; AverageStandardOutputsAnonSet: number; FinalMiningFeeRate: number; FreshInputsEstimateBtc: number }
export interface RoundsPage { Rounds: RoundRow[]; TotalCount: number; Page: number; PageSize: number; TotalPages: number }
