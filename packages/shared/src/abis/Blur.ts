export const BlurAbi = [
  {
    type: "event",
    name: "Execution721Packed",
    inputs: [
      { name: "orderHash", type: "bytes32", indexed: false },
      { name: "tokenIdListingIndexTrader", type: "uint256", indexed: false },
      { name: "collectionPriceSide", type: "uint256", indexed: false },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "Execution721TakerFeePacked",
    inputs: [
      { name: "orderHash", type: "bytes32", indexed: false },
      { name: "tokenIdListingIndexTrader", type: "uint256", indexed: false },
      { name: "collectionPriceSide", type: "uint256", indexed: false },
      { name: "takerFeeRecipientRate", type: "uint256", indexed: false },
    ],
    anonymous: false,
  },
] as const;
