import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const userId = '1e9c9d75-2095-4fa5-a422-87ad13fb3997'; // From the test logs
  const projectId = 'c2bdea43-a215-4f5b-b6ed-720d2ca63b72'; // From the test logs

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: {
      org: {
        include: {
          users: {
            where: { userId }
          }
        }
      }
    }
  });

  console.log(JSON.stringify(project, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
