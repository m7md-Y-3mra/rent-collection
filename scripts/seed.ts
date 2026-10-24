import { prisma } from '@/lib/prisma';

async function main() {
  console.log(`Organizations: ${await prisma.organizations.count()}`);
}
main().finally(() => prisma.$disconnect());
