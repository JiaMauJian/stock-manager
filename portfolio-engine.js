export const MAX_HOLDINGS = 5;

export function createDefaultPortfolio() {
  return normalizePortfolio({
    account: {
      name: "",
      code: "",
      feeRate: 0.0004275,
      priceApiUrl: "",
      taxRate: 0.003,
      minimumFee: 1,
      sellFeeThreshold: 20,
      initialCapital: 0,
      yearlyCapital: 0,
      cash: 0,
      reservedCash: 0,
    },
    holdings: [],
    orders: [],
  });
}

export function normalizePortfolio(input = {}) {
  const defaults = createSkeleton();
  const account = { ...defaults.account, ...(input.account || {}) };
  const holdings = Array.from({ length: MAX_HOLDINGS }, (_, index) => {
    const row = (input.holdings || [])[index] || {};
    return {
      symbol: stringValue(row.symbol),
      shares: numberValue(row.shares),
      cost: numberValue(row.cost),
      cashDividend: numberValue(row.cashDividend),
      stockDividend: numberValue(row.stockDividend),
      price: numberValue(row.price),
      targetWeight: clamp(numberValue(row.targetWeight), 0, 1),
    };
  });
  const orders = Array.from({ length: MAX_HOLDINGS }, (_, index) => {
    const row = (input.orders || [])[index] || {};
    return {
      quantity: numberValue(row.quantity),
      price: numberValue(row.price),
    };
  });

  return {
    account: {
      name: stringValue(account.name),
      code: stringValue(account.code),
      feeRate: nonNegative(account.feeRate),
      priceApiUrl: stringValue(account.priceApiUrl),
      taxRate: nonNegative(account.taxRate),
      minimumFee: nonNegative(account.minimumFee),
      sellFeeThreshold: nonNegative(account.sellFeeThreshold),
      initialCapital: numberValue(account.initialCapital),
      yearlyCapital: numberValue(account.yearlyCapital),
      cash: numberValue(account.cash),
      reservedCash: nonNegative(account.reservedCash),
    },
    holdings,
    orders,
  };
}

export function computePortfolio(input) {
  const portfolio = normalizePortfolio(input);
  const account = portfolio.account;
  const firstPass = portfolio.holdings.map((holding, index) =>
    computeHoldingBase(holding, account, index),
  );

  const totalCost = sum(firstPass.map((row) => row.totalCost)) + account.cash;
  const totalMarketValue = sum(firstPass.map((row) => row.marketValue)) + account.cash;
  const totalDividends = sum(firstPass.map((row) => row.cashDividendTotal));

  const holdings = firstPass.map((row) => ({
    ...row,
    costWeight: divideOrNull(row.totalCost, totalCost),
    marketWeight: divideOrNull(row.marketValue, totalMarketValue),
    returnRate: divideOrNull(row.profit, row.totalCost),
  }));

  const quickOrders = holdings.map((row) => {
    const amount =
      row.active && totalCost !== 0 ? (row.targetWeight - (row.costWeight || 0)) * totalCost : null;
    const quantity =
      amount === null || row.price <= 0
        ? null
        : excelRoundDown(amount / (row.price * (1 + account.feeRate)), 0);
    return {
      index: row.index,
      symbol: row.symbol,
      targetWeight: row.targetWeight,
      amount,
      quantity,
    };
  });

  const orderRows = holdings.map((row, index) => {
    const order = portfolio.orders[index] || { quantity: 0, price: 0 };
    const quantity = numberValue(order.quantity);
    const price = numberValue(order.price || row.price);
    return {
      index,
      symbol: row.symbol,
      quantity,
      price,
      settlement: settlementForOrder(quantity, price, account),
    };
  });

  const orderTotal = sum(orderRows.map((row) => row.settlement));
  const remainingCash = account.cash + orderTotal;
  const netWorth = totalMarketValue + totalDividends;
  const totalProfit = netWorth - account.initialCapital;
  const yearlyProfit = netWorth - account.yearlyCapital;

  return {
    account,
    holdings,
    quickOrders,
    orderRows,
    totals: {
      totalCost,
      totalMarketValue,
      totalDividends,
      netWorth,
      totalProfit,
      totalReturn: divideOrNull(totalProfit, account.initialCapital),
      yearlyProfit,
      yearlyReturn: divideOrNull(yearlyProfit, account.yearlyCapital),
      targetWeight: sum(holdings.map((row) => row.targetWeight)),
      orderTotal,
      remainingCash,
    },
    validation: validatePortfolio(portfolio),
  };
}

export function initializeOrders(input) {
  const portfolio = normalizePortfolio(input);
  const computed = computePortfolio(portfolio);
  return {
    ...portfolio,
    orders: computed.quickOrders.map((row, index) => ({
      quantity: row.quantity ?? 0,
      price: computed.holdings[index].price,
    })),
  };
}

export function clearOrders(input) {
  const portfolio = normalizePortfolio(input);
  return {
    ...portfolio,
    orders: Array.from({ length: MAX_HOLDINGS }, () => ({
      quantity: 0,
      price: 0,
    })),
  };
}

export function autoCalculateOrders(input, options = {}) {
  const tolerance = options.tolerance ?? 0.001;
  const maxIterations = options.maxIterations ?? 80;
  const portfolio = initializeOrders(input);
  const original = normalizePortfolio(input);
  let simulated = applyOrders(original, portfolio.orders);
  let orders = portfolio.orders.map((row) => ({ ...row }));

  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    const computed = computePortfolio(simulated);
    let changed = false;

    computed.holdings.forEach((row, index) => {
      const source = simulated.holdings[index];
      const price = source.price;
      if (!row.active || price <= 0) return;

      const diff = row.targetWeight - (row.costWeight || 0);
      let step = 0;
      if (row.targetWeight === 0 && source.shares > 0) {
        step = -source.shares;
      } else if (Math.abs(diff) > tolerance) {
        const amount = diff * computed.totals.totalCost;
        step = excelRoundDown(amount / (price * (1 + simulated.account.feeRate)), 0);
      }

      if (step < 0 && original.holdings[index].cost > price) {
        step = -Math.max(1, Math.round(Math.abs(source.shares) * 0.01));
      }

      if (step !== 0) {
        orders[index].quantity += step;
        orders[index].price = price;
        changed = true;
      }
    });

    if (!changed) break;
    simulated = applyOrders(original, orders);
  }

  orders = adjustCash(original, orders, options.maxCashAdjustments ?? 500);

  return {
    ...original,
    orders,
  };
}

export function validatePortfolio(input) {
  const portfolio = normalizePortfolio(input);
  const errors = [];
  const hasAnyHolding = portfolio.holdings.some((row) => row.symbol || row.shares || row.cost || row.price);
  if (!hasAnyHolding) errors.push("尚未輸入任何股票");

  portfolio.holdings.forEach((row, index) => {
    const label = row.symbol || `第 ${index + 1} 檔`;
    if (!row.symbol && (row.shares || row.cost || row.price || row.targetWeight)) {
      errors.push(`${label}: 有資料但沒有股票名稱或代號`);
    }
    if (row.symbol && row.price <= 0) {
      errors.push(`${label}: 股價尚未輸入`);
    }
  });

  const targetWeight = sum(portfolio.holdings.map((row) => row.targetWeight));
  if (roundTo(targetWeight, 3) > 1) errors.push("預計持股比重總和大於 100%");
  return errors;
}

export function settlementForOrder(quantity, price, accountInput) {
  const account = normalizePortfolio({ account: accountInput }).account;
  const qty = numberValue(quantity);
  const orderPrice = numberValue(price);
  if (qty === 0 || orderPrice <= 0) return 0;

  if (qty > 0) {
    const gross = qty * orderPrice;
    const fee = gross * account.feeRate;
    const cashFlow = fee > account.minimumFee ? -gross * (1 + account.feeRate) : -gross - account.minimumFee;
    return excelRoundDown(cashFlow, 0);
  }

  const gross = -qty * orderPrice;
  const fee = gross * account.feeRate;
  const cashFlow =
    fee > account.sellFeeThreshold
      ? gross * (1 - account.feeRate - account.taxRate)
      : gross * (1 - account.taxRate) - account.minimumFee;
  return excelRoundDown(cashFlow, 0);
}

export function excelRoundDown(value, digits = 0) {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** digits;
  return Math.trunc(value * factor) / factor;
}

export function applyOrders(input, ordersInput) {
  const portfolio = normalizePortfolio(input);
  const orders = Array.from({ length: MAX_HOLDINGS }, (_, index) => ({
    ...(ordersInput[index] || {}),
  }));
  const account = { ...portfolio.account };
  let cash = account.cash;

  const holdings = portfolio.holdings.map((holding, index) => {
    const quantity = numberValue(orders[index].quantity);
    const price = numberValue(orders[index].price || holding.price);
    cash += settlementForOrder(quantity, price, account);

    if (quantity > 0) {
      const newShares = holding.shares + quantity;
      const newCost =
        newShares === 0 ? holding.cost : (holding.shares * holding.cost + quantity * price) / newShares;
      return { ...holding, shares: newShares, cost: newCost };
    }

    return { ...holding, shares: Math.max(0, holding.shares + quantity) };
  });

  return normalizePortfolio({
    ...portfolio,
    account: { ...account, cash },
    holdings,
    orders,
  });
}

function adjustCash(original, currentOrders, maxAdjustments) {
  const orders = currentOrders.map((row) => ({ ...row }));
  const totalTargetWeight = sum(original.holdings.map((row) => row.targetWeight));

  for (let guard = 0; guard < maxAdjustments; guard += 1) {
    const simulated = applyOrders(original, orders);
    const computed = computePortfolio(simulated);
    const desiredCash = computed.totals.totalCost * Math.max(0, 1 - totalTargetWeight);
    const cashGap = computed.account.cash - desiredCash;

    if (Math.abs(cashGap) < 1) break;

    if (cashGap > 0) {
      const candidate = mostUnderweight(computed);
      if (!candidate) break;
      const price = simulated.holdings[candidate.index].price;
      if (price <= 0 || cashGap < price) break;
      orders[candidate.index].quantity += 1;
      orders[candidate.index].price = price;
    } else {
      const candidate = mostOverweight(computed, orders, original);
      if (!candidate) break;
      orders[candidate.index].quantity -= 1;
      orders[candidate.index].price = simulated.holdings[candidate.index].price;
    }
  }

  if (roundTo(totalTargetWeight, 3) === 1) {
    for (let guard = 0; guard < maxAdjustments; guard += 1) {
      const simulated = applyOrders(original, orders);
      const computed = computePortfolio(simulated);
      const candidate = highestAffordable(computed, simulated.account.cash);
      if (!candidate) break;
      orders[candidate.index].quantity += 1;
      orders[candidate.index].price = candidate.price;
    }
  }

  const simulated = applyOrders(original, orders);
  const remaining = computePortfolio(simulated).account.cash;
  if (remaining < 0) {
    for (let guard = 0; guard < maxAdjustments && computePortfolio(applyOrders(original, orders)).account.cash < 0; guard += 1) {
      const candidate = cheapestOrderedBuy(original, orders);
      if (!candidate) break;
      orders[candidate.index].quantity -= 1;
    }
  }

  return orders;
}

function computeHoldingBase(holding, account, index) {
  const active = Boolean(holding.symbol || holding.shares || holding.cost || holding.price || holding.targetWeight);
  const adjustedPrice = holding.price * (1 + holding.stockDividend / 10);
  const grossMarketValue = holding.shares * adjustedPrice;
  const totalCost = holding.shares * holding.cost * (1 + account.feeRate);
  const marketValue =
    grossMarketValue -
    excelRoundDown(grossMarketValue * account.feeRate, 0) -
    excelRoundDown(grossMarketValue * account.taxRate, 0);
  const cashDividendTotal = holding.cashDividend * holding.shares;

  return {
    index,
    active,
    symbol: holding.symbol,
    shares: holding.shares,
    cost: holding.cost,
    cashDividend: holding.cashDividend,
    cashDividendTotal,
    stockDividend: holding.stockDividend,
    price: holding.price,
    adjustedPrice,
    targetWeight: holding.targetWeight,
    totalCost,
    marketValue,
    profit: marketValue - totalCost + cashDividendTotal,
  };
}

function mostUnderweight(computed) {
  return computed.holdings
    .filter((row) => row.active && row.price > 0 && row.targetWeight > 0)
    .map((row) => ({ ...row, gap: row.targetWeight - (row.costWeight || 0) }))
    .sort((a, b) => b.gap - a.gap)[0];
}

function mostOverweight(computed, orders, original) {
  return computed.holdings
    .filter((row) => {
      const originalShares = original.holdings[row.index].shares;
      return row.active && row.price > 0 && originalShares + orders[row.index].quantity > 0;
    })
    .map((row) => ({ ...row, gap: (row.costWeight || 0) - row.targetWeight }))
    .sort((a, b) => b.gap - a.gap)[0];
}

function highestAffordable(computed, cash) {
  return computed.holdings
    .filter((row) => row.active && row.price > 0 && row.price <= cash)
    .sort((a, b) => b.price - a.price)[0];
}

function cheapestOrderedBuy(original, orders) {
  return original.holdings
    .map((row, index) => ({ index, price: row.price, quantity: orders[index].quantity }))
    .filter((row) => row.quantity > 0 && row.price > 0)
    .sort((a, b) => a.price - b.price)[0];
}

function createSkeleton() {
  return {
    account: {
      name: "",
      code: "",
      feeRate: 0.0004275,
      priceApiUrl: "",
      taxRate: 0.003,
      minimumFee: 1,
      sellFeeThreshold: 20,
      initialCapital: 0,
      yearlyCapital: 0,
      cash: 0,
      reservedCash: 0,
    },
    holdings: [],
    orders: [],
  };
}

function numberValue(value) {
  const parsed = typeof value === "string" ? Number(value.replace(/,/g, "")) : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function nonNegative(value) {
  return Math.max(0, numberValue(value));
}

function stringValue(value) {
  return value == null ? "" : String(value);
}

function sum(values) {
  return values.reduce((total, value) => total + numberValue(value), 0);
}

function divideOrNull(numerator, denominator) {
  return denominator === 0 ? null : numerator / denominator;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, numberValue(value)));
}

function roundTo(value, digits) {
  const factor = 10 ** digits;
  return Math.round(numberValue(value) * factor) / factor;
}
