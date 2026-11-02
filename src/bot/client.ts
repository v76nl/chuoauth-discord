import {
    Client,
    Events,
    GatewayIntentBits,
    MessageFlags,
    Routes,
    type REST
} from "discord.js";
import type { VerifiedUserRepository } from "../db/client.js";
import {
    handleSetupCommand,
    handleVerifyButton,
    setupCommand,
    VERIFY_BUTTON_ID
} from "./commands/setup.js";

export function createBotClient(deps: {
    guildId: string;
    loginUrl: string;
    repo: VerifiedUserRepository;
}): Client {
    const client = new Client({
        intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers]
    });

    client.once(Events.ClientReady, (ready) => {
        console.log(`Discord bot logged in as ${ready.user.tag}`);
    });

    client.on(Events.InteractionCreate, async (interaction) => {
        if (interaction.guildId !== deps.guildId) {
            return;
        }
        try {
            if (
                interaction.isChatInputCommand() &&
                interaction.commandName === setupCommand.name
            ) {
                await handleSetupCommand(interaction);
            } else if (
                interaction.isButton() &&
                interaction.customId === VERIFY_BUTTON_ID
            ) {
                await handleVerifyButton(interaction, deps);
            }
        } catch (err) {
            console.error("Failed to handle interaction", err);
            if (interaction.isRepliable() && !interaction.replied) {
                await interaction
                    .reply({
                        content: "エラーが発生しました",
                        flags: MessageFlags.Ephemeral
                    })
                    .catch(() => undefined);
            }
        }
    });

    return client;
}

export async function registerCommands(
    rest: REST,
    applicationId: string,
    guildId: string
): Promise<void> {
    await rest.put(Routes.applicationGuildCommands(applicationId, guildId), {
        body: [setupCommand.toJSON()]
    });
}
