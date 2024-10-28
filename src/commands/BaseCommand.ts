import { CommandContext, CommandMetadata } from '../types/commands.js';

export abstract class BaseCommand {
    public readonly metadata: CommandMetadata;

    constructor(metadata: CommandMetadata) {
        this.metadata = metadata;
    }

    abstract execute(context: CommandContext): Promise<void>;
}
