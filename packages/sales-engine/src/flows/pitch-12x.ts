import { Session, EngineOutput, BotResponse } from '../engine/types.js';

/**
 * Generates the burst sequence for the 12x Pitch (Flow A)
 * 
 * Sequence:
 * 1. Value Proposition (Immediate)
 * 2. Key Considerations (4s delay)
 * 3. Drawdown Rules (8s delay)
 */
export function generatePitch12xResponses(session: Session): EngineOutput {
  const responses: BotResponse[] = [
    {
      type: 'text',
      content: `Las Cuentas Apalancadas X12, son cuentas que te permiten operar con un capital mayor al que depositas.

Por ejemplo, si depositas $500 en una cuenta apalancada, podrás operar con $6,000. Es importante no perder más del 10% del balance de la cuenta apalancada para evitar el cierre de la misma.

Puedes retirar las ganancias desde el día #1 y el depósito inicial después de 30 días.

- Multiplicación del Saldo: Incrementa tu saldo 12 veces.
- Comisión Fija: $1 por 0.1 lote.
- Apalancamiento: 1:30
- Spreads: Desde 0.2 pips, ofreciendo precios muy competitivos.
- Ideal para: Traders que desean operar con un capital significativamente aumentado, disfrutando de alto apalancamiento y spreads ajustados.

La única regla en este tipo de cuentas es que no puedes perder más del 10% del monto inicial de tu Cuenta Apalancada.

Puedes operar Swing, Intradía, Scalping, Noticias o Bots, sin limitaciones.`,
      delayMs: 1000
    },
    {
      type: 'text',
      content: 
`1. No debes pasar ningún examen o prueba, la cuenta se entrega de inmediato.
2. Puedes retirar ganancias desde 1$ dólar en adelante, todos los días.`,
      delayMs: 4000
    },
    {
      type: 'text',
      content: `**Drawdown**
El drawdown de la cuenta es estático (no crece con el balance).
La única regla es no perder más del 10% del monto inicial.`,
      delayMs: 4000
    },
    {
      type: 'text',
      content: `¿Quieres registrarte y hacer tu primer depósito? Si tienes alguna inquietud, no dudes en preguntarme.`,
      delayMs: 4000
    }
  ];

  return {
    sessionId: session.id,
    responses,
    sessionUpdates: {
      context: {
        ...session.context,
        pitchComplete: true
      },
      lastMessageAt: new Date()
    }
  };
}
