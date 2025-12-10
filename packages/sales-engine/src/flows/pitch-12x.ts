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
`*Recalcar que:*
1. No debes pasar ningún examen o prueba, la cuenta se entrega de inmediato y lista para operar
2. Puedes retirar ganancias todos los días, desde el primer día
3. No hay reparto de ganancias, te quedas con el 100% de tus profits`,
      delayMs: 4000
    },
    {
      type: 'text',
      content: `*Drawdown*
El drawdown de la cuenta es estático, es decir:

No crece conforme aumenta el balance de tu capital.

Si tu cuenta de ejemplo 6.000$ pasa a 9.000$ y pierdes 3.000$ no traspasarías la regla.

Si el balance de la cuenta apalancada no va por debajo de los 5.400$ no hay ningún inconveniente.

También recalcar que con las mismas ganancias generadas puedes apalancarlas y unificarlas en una misma cuenta.

Siguiendo el ejemplo de los 3.000$ en profit, podrás aumentar tu cuenta por 36.000$ y quedar con un total de 42.000$ como balance inicial de tu cuenta apalancada.`,
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
