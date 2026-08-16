import { assert } from "chai";
import {
  applyOutFee,
  backing,
  floorScaled,
  interestFee,
  leverageFees,
  protocolFee,
  splitFee,
} from "../sdk/math";

const ONE = 1_000_000n;

describe("sdk/math", () => {
  it("backing sums vault and borrowed", () => {
    assert.equal(backing(100n * ONE, 50n * ONE), 150n * ONE);
  });

  it("floorScaled returns 1e6 when supply is zero", () => {
    assert.equal(floorScaled(0n, 0n), 1_000_000n);
  });

  it("floorScaled scales backing per supply", () => {
    assert.equal(floorScaled(200n * ONE, 100n * ONE), 2_000_000n);
  });

  it("protocolFee is 4%", () => {
    assert.equal(protocolFee(100n * ONE), 4_000_000n);
  });

  it("applyOutFee keeps 96% after outbound fee", () => {
    assert.equal(applyOutFee(100n * ONE), 96_000_000n);
  });

  it("splitFee divides fee 15/15/70", () => {
    const fee = 100n * ONE;
    const { pol, bribe, backing: stay } = splitFee(fee);
    assert.equal(pol, 15n * ONE);
    assert.equal(bribe, 15n * ONE);
    assert.equal(stay, 70n * ONE);
  });

  it("interestFee includes APY and base borrow fee", () => {
    const borrow = 100n * ONE;
    const fee30 = interestFee(borrow, 30);
    assert.isTrue(fee30 > 0n);
    assert.isTrue(fee30 > (borrow * 20n) / 10_000n, "includes base borrow fee");
  });

  it("leverageFees matches on-chain fee structure", () => {
    const amt = 20n * ONE;
    const fees = leverageFees(amt, 30);
    assert.equal(fees.bakeFee, (amt * 200n) / 10_000n);
    assert.equal(fees.userSpy, amt - fees.bakeFee);
    assert.equal(fees.userBorrow, (fees.userSpy * 9_900n) / 10_000n);
    assert.equal(fees.overCollat, (fees.userSpy * 200n) / 10_000n);
    assert.equal(
      fees.totalDue,
      fees.bakeFee + fees.interest + fees.overCollat
    );
  });
});
