# Contributing — Bullet

## Branche de référence (source of truth)

**Tout le monde travaille à partir de :**

```
cursor/genesis-vaults-and-chaos-black-ui
```

C’est la branche par défaut du dépôt (`origin/HEAD`). Elle contient le code canonique :

- Fees internes ×2 (mint/burn **5%**, borrow **7.8%** APY, leverage **2%**)
- Genesis tiers **0% / 2.5% / 4%** (100% fees tier → POL au finalize)
- Taxe DEX **8%** + transfer hook Token-2022 (gate anti-P2P)
- Fix leverage floor + max supply **5M** + scripts devnet

Ne pas continuer sur les anciennes branches isolées (`fix-leverage-floor-b4b2`, `transfer-hook-dex-tax-6ae6`, etc.) — elles sont **mergées** dans la branche ci-dessus.

## Workflow

1. **Sync** avant de coder :
   ```bash
   git fetch origin
   git checkout cursor/genesis-vaults-and-chaos-black-ui
   git pull origin cursor/genesis-vaults-and-chaos-black-ui
   ```

2. **Créer une branche** depuis cette base :
   ```bash
   git checkout -b cursor/ma-feature-<suffixe>
   ```

3. **Ouvrir une PR** vers `cursor/genesis-vaults-and-chaos-black-ui` (pas vers `main` sauf décision explicite).

4. **Après merge** : supprimer la branche feature pour éviter la dérive.

## Paramètres fees (ne pas diverger)

| Paramètre | Valeur | Fichiers de référence |
|-----------|--------|------------------------|
| Mint/burn protocol fee | 5% | `programs/bullet/src/state.rs`, `frontend/src/lib/bullet.ts`, `sdk/math.ts` |
| Genesis tiers | 0 / 2.5 / 4 % | `GENESIS_TIERS` dans `bullet.ts`, `scripts/init-genesis-vaults.ts` |
| DEX transfer tax | 8% (800 bps) | `DEFAULT_DEX_TRANSFER_TAX_BPS`, hook config |
| Fee split (hors genesis) | 70/15/15 | `FEE_BACKING_BPS`, `FEE_POL_BPS`, `FEE_BRIBE_BPS` |
| Max supply | 5 000 000 | `DEFAULT_MAX_SUPPLY` |

Toute modification de fees doit toucher **on-chain + SDK + frontend + tests** dans le même PR.

## Devnet & frontend

- Adresses devnet : `deployed-devnet.json` + `frontend/src/lib/bullet.ts` (garder synchronisés via `npm run sync:frontend` après redeploy).
- Redéploiement : `npm run redeploy:devnet` (voir `AGENTS.md`).
- **Vercel** : lier le projet à la branche `cursor/genesis-vaults-and-chaos-black-ui` pour que la prod reflète le code canonique.

## Tests avant PR

```bash
anchor build
npx ts-mocha -p ./tsconfig.json tests/sdk-math.ts
cd frontend && npm run build
# optionnel : npm run test:localnet (voir AGENTS.md pour keys sync)
```

## Branches obsolètes

Les branches parallèles avec des specs fees différentes (ex. 4% mint/burn, genesis 3.5%) ne sont **pas** la référence. Rebaser ou fermer ces PRs au profit de la branche par défaut.
