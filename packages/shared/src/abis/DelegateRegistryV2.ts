// delegate.cash v2 registry. Only the read-paths we use for verification.
// Full registry: https://github.com/delegatexyz/delegate-registry/blob/main/src/DelegateRegistry.sol
export const DelegateRegistryV2Abi = [
  {
    type: "function",
    stateMutability: "view",
    name: "checkDelegateForAll",
    inputs: [
      { name: "to", type: "address" },
      { name: "from", type: "address" },
      { name: "rights", type: "bytes32" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    stateMutability: "view",
    name: "checkDelegateForContract",
    inputs: [
      { name: "to", type: "address" },
      { name: "contract_", type: "address" },
      { name: "from", type: "address" },
      { name: "rights", type: "bytes32" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;
