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
      content: `Te explico cómo funcionan:\n\nLas Cuentas Apalancadas X12, son cuentas que te permiten operar con un capital mayor al que depositas.\n\nPor ejemplo, si depositas $500 en una cuenta apalancada, podrás operar con $6,000. \n\nEs importante no perder más del 10% del balance de la cuenta apalancada para evitar el cierre de la misma.\n\nEste drawdown es estático y no crece conforme aumente el balance de tu cuenta. (Así que no afecta tus ganancias)`,
      delayMs: 1000
    },
    {
      type: 'text',
      content: `*Recalcar que:*\n1. No debes pasar ningún examen o prueba, la cuenta se entrega de inmediato y lista para operar\n2. Puedes retirar ganancias todos los días, desde el primer día\n3. No hay reparto de ganancias, te quedas con el 100% de tus profits`,
      delayMs: 4000
    },
    {
      type: 'text',
      content: `Si tienes alguna inquietud, no dudes en preguntarme.`,
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
