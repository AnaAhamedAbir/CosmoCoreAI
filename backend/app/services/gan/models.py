import torch
import torch.nn as nn

class Embedder(nn.Module):
    def __init__(self, input_dim: int, hidden_dim: int, num_layers: int = 1):
        super(Embedder, self).__init__()
        # Using GRU instead of LSTM for better CPU performance (fewer gates)
        self.rnn = nn.GRU(input_dim, hidden_dim, num_layers, batch_first=True)
        self.fc = nn.Linear(hidden_dim, hidden_dim)
        self.sigmoid = nn.Sigmoid()

    def forward(self, x):
        # x shape: (batch_size, seq_len, input_dim)
        out, _ = self.rnn(x)
        out = self.fc(out)
        out = self.sigmoid(out)
        return out


class Recovery(nn.Module):
    def __init__(self, hidden_dim: int, output_dim: int, num_layers: int = 1):
        super(Recovery, self).__init__()
        self.rnn = nn.GRU(hidden_dim, hidden_dim, num_layers, batch_first=True)
        self.fc = nn.Linear(hidden_dim, output_dim)
        # Removed Sigmoid because financial data is standard scaled and has negative values.

    def forward(self, x):
        # x shape: (batch_size, seq_len, hidden_dim)
        out, _ = self.rnn(x)
        out = self.fc(out)
        return out


class Generator(nn.Module):
    def __init__(self, z_dim: int, hidden_dim: int, num_layers: int = 1):
        super(Generator, self).__init__()
        self.rnn = nn.GRU(z_dim, hidden_dim, num_layers, batch_first=True)
        self.fc = nn.Linear(hidden_dim, hidden_dim)
        self.sigmoid = nn.Sigmoid()

    def forward(self, z):
        # z shape: (batch_size, seq_len, z_dim)
        out, _ = self.rnn(z)
        out = self.fc(out)
        out = self.sigmoid(out)
        return out


class Discriminator(nn.Module):
    def __init__(self, hidden_dim: int, num_layers: int = 1):
        super(Discriminator, self).__init__()
        self.rnn = nn.GRU(hidden_dim, hidden_dim, num_layers, batch_first=True)
        self.fc = nn.Linear(hidden_dim, 1)
        self.sigmoid = nn.Sigmoid()

    def forward(self, h):
        # h shape: (batch_size, seq_len, hidden_dim)
        out, _ = self.rnn(h)
        out = self.fc(out)
        out = self.sigmoid(out)
        return out

class Supervisor(nn.Module):
    def __init__(self, hidden_dim: int, num_layers: int = 1):
        super(Supervisor, self).__init__()
        self.rnn = nn.GRU(hidden_dim, hidden_dim, num_layers, batch_first=True)
        self.fc = nn.Linear(hidden_dim, hidden_dim)
        self.sigmoid = nn.Sigmoid()

    def forward(self, h):
        # h shape: (batch_size, seq_len, hidden_dim)
        out, _ = self.rnn(h)
        out = self.fc(out)
        out = self.sigmoid(out)
        return out
