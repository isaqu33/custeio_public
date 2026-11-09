import { prepareDockerDependencies } from './docker-deps';

export default async function globalSetup() {
  return prepareDockerDependencies();
}
